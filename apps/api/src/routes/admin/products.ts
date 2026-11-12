import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaginationQuerySchema } from "@mall/types";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

const createProductBody = z.object({
  title: z.string(),
  handle: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  product_type_id: z.string().optional(),
  /** 运费模板（对齐淘宝发布页「物流信息」）；不传用默认模板。 */
  shipping_profile_id: z.string().nullable().optional(),
  /** 卖家包邮（淘宝的「卖家承担运费」）。 */
  free_shipping: z.boolean().optional(),
  variants: z
    .array(
      z.object({
        sku: z.string(),
        title: z.string(),
        options: z.record(z.string(), z.string()).optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
      }),
    )
    .optional(),
  category_ids: z.array(z.string()).optional(),
});
const updateProductBody = z.object({
  title: z.string().optional(),
  handle: z.string().optional(),
  subtitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  shipping_profile_id: z.string().nullable().optional(),
  free_shipping: z.boolean().optional(),
});
/** 列表筛选：状态页签 + 标题/编码搜索（对应淘宝的「出售中/仓库中」与搜索框）。 */
const adminProductListQuery = PaginationQuerySchema.extend({
  status: z.enum(["draft", "published", "archived"]).optional(),
  q: z.string().min(1).max(60).optional(),
});

/** 批量操作：上架 / 下架 / 删除。上限 100，避免一次误点清空整个店。 */
const bulkBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["publish", "unpublish", "delete"]),
});

/** 整组替换图片：只传文件 id 顺序，第一张即主图。 */
const productImagesBody = z.object({
  file_ids: z.array(z.string().min(1)).max(12),
});

const createVariantBody = z.object({
  sku: z.string(),
  title: z.string(),
  options: z.record(z.string(), z.string()).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});
const updateVariantBody = z.object({
  title: z.string().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});
const setPricesBody = z.object({
  prices: z
    .array(
      z.object({
        currency_code: z.string().length(3),
        amount_minor: z.number().int().nonnegative(),
        price_list_id: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

/**
 * 给图片补公开 URL。
 *
 * 前端不该知道 storage key 怎么拼（本地 Provider 与对象存储的规则不同），
 * 所以由后端一次算好；取不到 URL 时给 null，不让整张详情页 500。
 */
async function withImageUrls(
  deps: AppDeps,
  detail: Awaited<ReturnType<AppDeps["services"]["product"]["retrieveProduct"]>>,
) {
  const images = await Promise.all(
    detail.images.map(async (img) => ({
      ...img,
      url: await deps.services.file.getPublicUrl(img.file_id).catch(() => null),
    })),
  );
  return { ...detail, images };
}

/** Admin 商品 8 端点（openapi 1207/1268/1330/1355/1380）。 */
export function adminProductRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("products")];

  app.get(
    "/api/v1/admin/products",
    { preHandler: guard, schema: { querystring: adminProductListQuery } },
    async (req, reply) => {
      const q = req.query as z.infer<typeof adminProductListQuery>;
      const res = await deps.services.product.listProducts({
        limit: q.limit,
        offset: q.offset,
        status: q.status,
        q: q.q,
      });
      // 列表首列要显示主图：批量取 URL（一次查询，不做 N+1）
      const thumbIds = res.items
        .map((p) => p.thumbnail_file_id)
        .filter((id): id is string => Boolean(id));
      const urls = thumbIds.length > 0 ? await deps.services.file.getPublicUrls(thumbIds) : {};
      // 页签角标：一次 GROUP BY，别让前端为三个数字发三个请求
      const counts = await deps.services.product.countByStatus();
      reply.ok({
        items: res.items.map((p) => ({
          ...p,
          thumbnail_url: p.thumbnail_file_id ? (urls[p.thumbnail_file_id] ?? null) : null,
        })),
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
        counts: {
          all: Object.values(counts).reduce((s, n) => s + n, 0),
          published: counts.published ?? 0,
          draft: counts.draft ?? 0,
        },
      });
    },
  );

  /**
   * 批量操作（对齐淘宝商品管理的批量上架/下架/删除）。
   *
   * 一条 SQL 完成，不循环单条更新：100 条商品会变成 100 次往返 + 100 条审计。
   * 返回 affected 与 requested 两个数：前端据此提示「有 3 条已被别处删除」这类情况。
   */
  app.post(
    "/api/v1/admin/products/bulk",
    { preHandler: guard, schema: { body: bulkBody } },
    async (req, reply) => {
      const { ids, action } = req.body as z.infer<typeof bulkBody>;
      const affected =
        action === "delete"
          ? await deps.services.product.bulkDelete(ids)
          : await deps.services.product.bulkUpdateStatus(
              ids,
              action === "publish" ? "published" : "draft",
            );
      await deps.audit.record(
        auditEntry(req, {
          action: `product.bulk_${action}`,
          entityType: "product",
          entityId: ids.join(",").slice(0, 200),
          after: { requested: ids.length, affected },
        }),
      );
      reply.ok({ requested: ids.length, affected });
    },
  );

  app.post(
    "/api/v1/admin/products",
    { preHandler: guard, schema: { body: createProductBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createProductBody>;
      const product = await deps.services.product.createProduct({
        title: b.title,
        handle: b.handle,
        subtitle: b.subtitle,
        description: b.description,
        status: b.status,
        productTypeId: b.product_type_id ?? null,
        shippingProfileId: b.shipping_profile_id ?? null,
        freeShipping: b.free_shipping ?? false,
        variants: b.variants?.map((v) => ({
          sku: v.sku,
          title: v.title,
          options: v.options,
          status: v.status,
        })),
        categoryIds: b.category_ids,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "product.create",
          entityType: "product",
          entityId: product.id,
          after: product,
        }),
      );
      reply.code(201).ok(product);
    },
  );

  app.get("/api/v1/admin/products/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = await deps.services.product.retrieveProduct(id);
    reply.ok(await withImageUrls(deps, detail));
  });

  /**
   * 整组替换商品图片（对齐淘宝发布页的「商品图片」：主图 + 图集）。
   *
   * 用整组替换而不是增删单张：商家在界面上拖动排序、删中间一张，
   * 前端只提交最终顺序，服务端一次落库，不会出现顺序错乱或残留。
   */
  app.put(
    "/api/v1/admin/products/:id/images",
    { preHandler: guard, schema: { body: productImagesBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof productImagesBody>;
      const before = await deps.services.product.retrieveProduct(id);
      const detail = await deps.services.product.replaceProductImages(id, body.file_ids);
      await deps.audit.record(
        auditEntry(req, {
          action: "product.images.replace",
          entityType: "product",
          entityId: id,
          before: { images: before.images.map((i) => i.file_id) },
          after: { images: body.file_ids },
        }),
      );
      reply.ok(await withImageUrls(deps, detail));
    },
  );

  app.patch(
    "/api/v1/admin/products/:id",
    { preHandler: guard, schema: { body: updateProductBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updateProductBody>;
      const before = await deps.services.product.retrieveProduct(id);
      const updated = await deps.services.product.updateProduct(id, {
        title: b.title,
        handle: b.handle,
        subtitle: b.subtitle,
        description: b.description,
        status: b.status,
        // 下面两个必须显式映射：body 是 snake_case，服务层是 camelCase，
        // `{ ...b }` 会让它们静默丢掉（商品保存成功但运费设置没生效）。
        ...(b.shipping_profile_id !== undefined
          ? { shippingProfileId: b.shipping_profile_id }
          : {}),
        ...(b.free_shipping !== undefined ? { freeShipping: b.free_shipping } : {}),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "product.update",
          entityType: "product",
          entityId: id,
          before,
          after: updated,
        }),
      );
      reply.ok(updated);
    },
  );

  app.delete("/api/v1/admin/products/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await deps.services.product.retrieveProduct(id);
    await deps.services.product.deleteProduct(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "product.delete",
        entityType: "product",
        entityId: id,
        before,
      }),
    );
    reply.code(204).send();
  });

  app.post(
    "/api/v1/admin/products/:id/variants",
    { preHandler: guard, schema: { body: createVariantBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof createVariantBody>;
      const variant = await deps.services.product.createVariant(id, {
        sku: b.sku,
        title: b.title,
        options: b.options,
        status: b.status,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "variant.create",
          entityType: "variant",
          entityId: variant.id,
          after: variant,
        }),
      );
      reply.code(201).ok(variant);
    },
  );

  app.patch(
    "/api/v1/admin/variants/:id",
    { preHandler: guard, schema: { body: updateVariantBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [before] = await deps.services.product.listVariantsByIds([id]);
      const updated = await deps.services.product.updateVariant(
        id,
        req.body as z.infer<typeof updateVariantBody>,
      );
      await deps.audit.record(
        auditEntry(req, {
          action: "variant.update",
          entityType: "variant",
          entityId: id,
          before: before ?? null,
          after: updated,
        }),
      );
      reply.ok(updated);
    },
  );

  app.put(
    "/api/v1/admin/variants/:id/prices",
    { preHandler: guard, schema: { body: setPricesBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof setPricesBody>;
      const result = await deps.services.pricing.setPrices({
        variantId: id,
        prices: b.prices.map((p) => ({
          currencyCode: p.currency_code,
          amountMinor: BigInt(p.amount_minor),
          priceListId: p.price_list_id ?? null,
        })),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "variant.prices.set",
          entityType: "variant",
          entityId: id,
          after: { price_set_id: result.priceSetId, prices: b.prices },
        }),
      );
      reply.ok({ price_set_id: result.priceSetId });
    },
  );
}
