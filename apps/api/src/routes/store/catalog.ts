import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import { PaginationQuerySchema } from "@mall/types";
import type { AppDeps } from "../../deps.js";
import { resolveChannelId } from "../../plugins/auth.js";

/** GET /store/bootstrap — 一次性拿 channel/locale/币种/导航/主题（openapi 659）。 */
export function bootstrapRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/store/bootstrap", async (req, reply) => {
    const channelId = await resolveChannelId(deps, req);
    const channel = await deps.services.regionChannel.getChannel(channelId);
    const theme = await deps.services.theme.getSettings();
    reply.ok({
      channel: {
        id: channel.id,
        slug: channel.slug,
        currency_code: channel.currency_code,
        default_locale: channel.default_locale,
        market_scope: channel.market_scope,
      },
      locale: channel.default_locale,
      currencies: [channel.currency_code],
      navigation: [],
      theme,
    });
  });
}

const productListQuery = PaginationQuerySchema.extend({
  q: z.string().optional(),
  category: z.string().optional(),
  sort: z.string().optional(),
});

/** GET /store/products + /store/products/{handle} + /store/categories（openapi 686/720/741）。 */
export function productRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    "/api/v1/store/products",
    { schema: { querystring: productListQuery } },
    async (req, reply) => {
      const q = req.query as { limit: number; offset: number; q?: string; category?: string; sort?: string };
      const channelId = await resolveChannelId(deps, req);
      const channel = await deps.services.regionChannel.getChannel(channelId);
      const res = await deps.services.product.listProductsWithVariants({
        limit: q.limit,
        offset: q.offset,
        status: "published",
        q: q.q,
        categoryId: q.category,
        sort: q.sort,
      });

      // 批量计价（一次 pricing.calculatePrices，禁 N+1），商品价取变体最低价
      const variantIds = res.items.flatMap((p) => p.variants.map((v) => v.id));
      const prices =
        variantIds.length > 0
          ? await deps.services.pricing.calculatePrices({
              variantIds,
              context: { currencyCode: channel.currency_code, channelId },
            })
          : [];
      const priceByVariant = new Map(prices.map((p) => [p.variantId, p.amountMinor]));
      // 主图：批量取 URL。原来这里写死 null，导致店面列表永远没有图。
      const thumbIds = res.items
        .map((p) => p.thumbnail_file_id)
        .filter((id): id is string => Boolean(id));
      const thumbUrls = thumbIds.length > 0 ? await deps.services.file.getPublicUrls(thumbIds) : {};
      const items = res.items.map((p) => {
        const amounts = p.variants
          .map((v) => priceByVariant.get(v.id))
          .filter((a): a is bigint => a !== undefined);
        const min = amounts.length > 0 ? amounts.reduce((a, b) => (a < b ? a : b)) : undefined;
        return {
          id: p.id,
          title: p.title,
          handle: p.handle,
          subtitle: p.subtitle,
          status: p.status,
          thumbnail_url: p.thumbnail_file_id ? (thumbUrls[p.thumbnail_file_id] ?? null) : null,
          price:
            min !== undefined
              ? { amount_minor: Number(min), currency_code: channel.currency_code }
              : undefined,
        };
      });

      // 价格排序（价格来自批量计价结果，内存排即可，无需二次查询）
      if (q.sort === "price.asc") {
        items.sort((a, b) => (a.price?.amount_minor ?? 0) - (b.price?.amount_minor ?? 0));
      } else if (q.sort === "price.desc") {
        items.sort((a, b) => (b.price?.amount_minor ?? 0) - (a.price?.amount_minor ?? 0));
      }

      reply.ok({
        items,
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + items.length < res.count,
      });
    },
  );

  // 聚合视图：一次返回变体 + 价格 + 库存 + 图（不让前端串 6 个请求）
  app.get("/api/v1/store/products/:handle", async (req, reply) => {
    const { handle } = req.params as { handle: string };
    const channelId = await resolveChannelId(deps, req);
    const channel = await deps.services.regionChannel.getChannel(channelId);

    const listed = await deps.services.product.listProducts({ handle, status: "published", limit: 1 });
    const summary = listed.items[0];
    if (!summary) throw errors.notFound(`product not found: ${handle}`);
    const detail = await deps.services.product.retrieveProduct(summary.id);

    const variantIds = detail.variants.map((v) => v.id);
    const [prices, availability] = await Promise.all([
      variantIds.length
        ? deps.services.pricing.calculatePrices({
            variantIds,
            context: { currencyCode: channel.currency_code },
          })
        : Promise.resolve([]),
      variantIds.length ? deps.services.inventory.getAvailability({ variantIds }) : Promise.resolve([]),
    ]);
    const priceByVariant = new Map(prices.map((p) => [p.variantId, p]));
    const availByVariant = new Map(availability.map((a) => [a.variantId, a.available]));

    reply.ok({
      id: detail.id,
      title: detail.title,
      handle: detail.handle,
      subtitle: detail.subtitle,
      description: detail.description,
      status: detail.status,
      images: await (async () => {
        // URL 必须由 file 模块按 storage key 生成；直接拼 file_id 会 404（key ≠ id）
        const urls = await deps.services.file.getPublicUrls(detail.images.map((i) => i.file_id));
        return detail.images.map((img) => ({
          id: img.id,
          url: urls[img.file_id] ?? "",
          alt: img.alt,
          is_primary: img.is_primary,
        }));
      })(),
      variants: detail.variants.map((v) => {
        const price = priceByVariant.get(v.id);
        const available = availByVariant.get(v.id) ?? 0;
        return {
          id: v.id,
          title: v.title,
          sku: v.sku,
          status: v.status,
          price: price
            ? { amount_minor: price.amountMinor, currency_code: price.currencyCode }
            : null,
          available_quantity: available,
          inventory_status: available > 5 ? "in_stock" : available > 0 ? "low_stock" : "out_of_stock",
        };
      }),
      attributes: [],
    });
  });

  /**
   * 店面分类（ADR-028）。
   *
   * 返回全部分类（含两级结构）：一级分类 parent_id = null，二级挂在下面。
   * 商品数只算「上架中」—— 把草稿算进去会让分类页写着 10 件、点开只有 3 件。
   */
  app.get("/api/v1/store/categories", async (_req, reply) => {
    const items = await deps.services.product.listCategories(true);
    reply.ok({
      items,
      count: items.length,
      offset: 0,
      limit: items.length,
      hasMore: false,
    });
  });
}
