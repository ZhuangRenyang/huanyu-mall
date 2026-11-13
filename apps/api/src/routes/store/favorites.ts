import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import { PaginationQuerySchema } from "@mall/types";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers, resolveChannelId } from "../../plugins/auth.js";
import { mapStoreProductSummaries } from "./catalog.js";

/**
 * 商品收藏（店面，ADR-048）。
 *
 * 淘宝的「收藏宝贝」：详情页一颗星，账户页一个收藏夹。
 * 全部需要登录 —— 收藏是顾客的私有数据，归属只认 token 里的 customerId。
 */
const productIdParams = z.object({ productId: z.string().min(1).max(64) });

function requireCustomerId(req: FastifyRequest): string {
  if (!req.auth || req.auth.scope !== "customer" || !req.auth.customerId) {
    throw errors.unauthenticated("请先登录");
  }
  return req.auth.customerId;
}

export function storeFavoriteRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  /**
   * 收藏的商品卡片。
   *
   * 复用商品列表的映射（价格 / 可用量 / 主图），保证收藏里的卡片
   * 与列表、详情给的是同一套数据 —— 不然会出现「列表 99、收藏 129」。
   */
  app.get(
    "/api/v1/store/customer/favorites",
    { preHandler: auth.customerAuth, schema: { querystring: PaginationQuerySchema } },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const q = req.query as { limit: number; offset: number };
      const channelId = await resolveChannelId(deps, req);
      const channel = await deps.services.regionChannel.getChannel(channelId);

      const page = await deps.services.customer.listFavorites(customerId, {
        limit: q.limit,
        offset: q.offset,
      });
      // 已下架/已删除的商品不再出现在收藏里（但收藏记录保留，重新上架会再出现）
      const listed = await deps.services.product.listProductsWithVariants({
        ids: page.items.map((f) => f.product_id),
        status: "published",
        limit: Math.max(1, page.items.length),
        offset: 0,
      });
      const byId = new Map(listed.items.map((p) => [p.id, p]));
      // 按收藏顺序排（商品接口按创建时间返回，不能直接拿来当顺序）
      const ordered = page.items
        .map((f) => byId.get(f.product_id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
      const items = await mapStoreProductSummaries(deps, channel, channelId, ordered);

      reply.ok({
        items,
        count: page.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + items.length < page.count,
      });
    },
  );

  /** 收藏的商品 id 列表（详情页判断是否已收藏，不分页）。 */
  app.get(
    "/api/v1/store/customer/favorites/ids",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const ids = await deps.services.customer.listFavoriteProductIds(customerId);
      reply.ok({ product_ids: ids });
    },
  );

  /** 收藏（幂等：已收藏再点不报错，返回 204）。 */
  app.post(
    "/api/v1/store/customer/favorites/:productId",
    { preHandler: auth.customerAuth, schema: { params: productIdParams } },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const { productId } = req.params as { productId: string };
      // 商品必须存在且上架：收藏一个不存在的 id 没有意义，还会在收藏页留空行
      const listed = await deps.services.product.listProducts({
        ids: [productId],
        status: "published",
        limit: 1,
      });
      if (listed.items.length === 0) throw errors.notFound(`product not found: ${productId}`);
      await deps.services.customer.addFavorite(customerId, productId);
      reply.code(204).send();
    },
  );

  /** 取消收藏（不报「没收藏过」：重复取消是幂等的）。 */
  app.delete(
    "/api/v1/store/customer/favorites/:productId",
    { preHandler: auth.customerAuth, schema: { params: productIdParams } },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const { productId } = req.params as { productId: string };
      await deps.services.customer.removeFavorite(customerId, productId);
      reply.code(204).send();
    },
  );
}
