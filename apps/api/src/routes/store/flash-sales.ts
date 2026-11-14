import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";

/**
 * 店面秒杀（ADR-099）。
 *
 * 只下发**正在进行且还有剩余**的活动：售完的、没到点的、已结束的都不给，
 * 前台就不会出现「点进去发现没货」。
 *
 * 价格是活动价（flash_price_minor），下单时由 promotion.computeDiscounts
 * 按购物车真实单价再算一次优惠 —— 前端展示的价格不参与任何计价。
 */
export function storeFlashSaleRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/store/flash-sales", async (_req, reply) => {
    const items = await deps.services.promotion.listActiveFlashSales();
    reply.ok({ items });
  });
}
