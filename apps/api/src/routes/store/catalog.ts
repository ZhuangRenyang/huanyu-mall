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
    // 店头 Logo：URL 必须由 file 模块按 storage key 生成（直接拼 file_id 会 404）
    const logoUrl = theme.logo_file_id
      ? (await deps.services.file.getPublicUrls([theme.logo_file_id]))[theme.logo_file_id] ?? null
      : null;
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
      // logo_url 与 theme 平铺：前端不该知道 file_id 与 URL 的区别
      theme: { ...theme, logo_url: logoUrl },
    });
  });
}

const productListQuery = PaginationQuerySchema.extend({
  q: z.string().optional(),
  category: z.string().optional(),
  sort: z.string().optional(),
});


/**
 * 商品摘要映射（列表 / 收藏共用）。
 *
 * 一次批量计价 + 一次批量库存 + 一次批量取图，禁 N+1。
 * 抽出来是因为收藏列表要和商品列表给出完全一样的卡片数据 ——
 * 复制一份迟早出现「列表有优惠价、收藏里是原价」这种两套口径。
 */
export async function mapStoreProductSummaries(
  deps: AppDeps,
  channel: { currency_code: string },
  channelId: string,
  products: Awaited<ReturnType<AppDeps["services"]["product"]["listProductsWithVariants"]>>["items"],
) {
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const [prices, availability, sold] = await Promise.all([
    variantIds.length > 0
      ? deps.services.pricing.calculatePrices({
          variantIds,
          context: { currencyCode: channel.currency_code, channelId },
        })
      : Promise.resolve([]),
    // 库存也批量取：列表要标「已售罄」，缺了它顾客只能点进详情才发现卖完了（ADR-041）
    variantIds.length > 0 ? deps.services.inventory.getAvailability({ variantIds }) : Promise.resolve([]),
    // 销量：商品级「已售 N 件」是社交证明（ADR-067），一次 GROUP BY 取全
    variantIds.length > 0 ? deps.services.order.countSoldByVariants(variantIds) : Promise.resolve({}),
  ]);
  const priceByVariant = new Map(prices.map((p) => [p.variantId, p.amountMinor]));
  const availByVariant = new Map(availability.map((a) => [a.variantId, a.available]));
  const soldByVariant = sold as Record<string, number>;
  // 主图：批量取 URL。原来这里写死 null，导致店面列表永远没有图。
  const thumbIds = products
    .map((p) => p.thumbnail_file_id)
    .filter((id): id is string => Boolean(id));
  const thumbUrls = thumbIds.length > 0 ? await deps.services.file.getPublicUrls(thumbIds) : {};

  return products.map((p) => {
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
      // 商品级可用量 = 各变体可用量之和（0 = 售罄，店面前端据此标「已售罄」）
      available_quantity: p.variants.reduce((sum, v) => sum + (availByVariant.get(v.id) ?? 0), 0),
      // 商品级销量 = 各变体销量之和（ADR-067，社交证明）
      sold_count: p.variants.reduce((sum, v) => sum + (soldByVariant[v.id] ?? 0), 0),
    };
  });
}

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

      // 价格 / 库存 / 主图一次批量取完（与收藏列表同一套映射）
      const items = await mapStoreProductSummaries(deps, channel, channelId, res.items);

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
    const [prices, availability, sold] = await Promise.all([
      variantIds.length
        ? deps.services.pricing.calculatePrices({
            variantIds,
            context: { currencyCode: channel.currency_code },
          })
        : Promise.resolve([]),
      variantIds.length ? deps.services.inventory.getAvailability({ variantIds }) : Promise.resolve([]),
      variantIds.length
        ? deps.services.order.countSoldByVariants(variantIds)
        : Promise.resolve({}),
    ]);
    const priceByVariant = new Map(prices.map((p) => [p.variantId, p]));
    const availByVariant = new Map(availability.map((a) => [a.variantId, a.available]));
    const soldByVariant = sold as Record<string, number>;

    reply.ok({
      id: detail.id,
      title: detail.title,
      handle: detail.handle,
      subtitle: detail.subtitle,
      description: detail.description,
      status: detail.status,
      // 商品级销量（ADR-067）：各变体销量之和
      sold_count: detail.variants.reduce((sum, v) => sum + (soldByVariant[v.id] ?? 0), 0),
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
          sold_count: soldByVariant[v.id] ?? 0,
        };
      }),
      attributes: [],
      // 所属分类：店面面包屑「全部商品 > 服饰 > 外套 > 商品」靠它，
      // 也是分类页与商品页之间的内链（ADR-040）
      categories: await (async () => {
        if (detail.category_ids.length === 0) return [];
        const all = await deps.services.product.listCategories(true);
        const byId = new Map(all.map((c) => [c.id, c]));
        const own = detail.category_ids
          .map((id) => byId.get(id))
          .filter((c): c is NonNullable<typeof c> => Boolean(c));
        // 商品通常只挂二级分类：把父级也带上，面包屑才能显示「服饰 > 外套」
        const withParents = [...own];
        for (const c of own) {
          if (c.parent_id && !withParents.some((x) => x.id === c.parent_id)) {
            const parent = byId.get(c.parent_id);
            if (parent) withParents.push(parent);
          }
        }
        return withParents.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id }));
      })(),
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
