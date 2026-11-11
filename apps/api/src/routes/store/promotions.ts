import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";

/**
 * 店面营销功能开关（只读）。
 *
 * 顾客侧据此隐藏已关闭功能的输码入口——功能关闭时不该让顾客输了码才发现没折扣。
 * 开关值以后端为准，前端不缓存、不推断。
 */
export function storePromotionRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/store/promotions/features", async (_req, reply) => {
    reply.ok(await deps.services.promotion.getFeatureFlags());
  });
}
