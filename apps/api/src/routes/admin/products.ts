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

/** Admin 商品 8 端点（openapi 1207/1268/1330/1355/1380）。 */
export function adminProductRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("products")];

  app.get(
    "/api/v1/admin/products",
    { preHandler: guard, schema: { querystring: PaginationQuerySchema } },
    async (req, reply) => {
      const q = req.query as { limit: number; offset: number };
      const res = await deps.services.product.listProducts({ limit: q.limit, offset: q.offset });
      reply.ok({
        items: res.items,
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
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
    reply.ok(await deps.services.product.retrieveProduct(id));
  });

  app.patch(
    "/api/v1/admin/products/:id",
    { preHandler: guard, schema: { body: updateProductBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updateProductBody>;
      const before = await deps.services.product.retrieveProduct(id);
      const updated = await deps.services.product.updateProduct(id, { ...b });
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
