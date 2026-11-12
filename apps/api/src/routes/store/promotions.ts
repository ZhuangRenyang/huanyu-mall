import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers, resolveChannelId } from "../../plugins/auth.js";

/**
 * 店面营销：功能开关 + 领券（ADR-029）。
 *
 * 领券把「券模板」变成顾客卡券包里的一张券：领取时自动发一条专属券码，
 * 核销仍走原有 voucher_code 链路，所以折扣计算与超用保护一行都不用改。
 */
function requireCustomerId(req: FastifyRequest): string {
  if (!req.auth || req.auth.scope !== "customer" || !req.auth.customerId) {
    throw errors.unauthenticated("请先登录");
  }
  return req.auth.customerId;
}

export function storePromotionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  /**
   * 店面营销功能开关（只读）。
   *
   * 顾客侧据此隐藏已关闭功能的输码入口——功能关闭时不该让顾客输了码才发现没折扣。
   * 开关值以后端为准，前端不缓存、不推断。
   */
  app.get("/api/v1/store/promotions/features", async (_req, reply) => {
    reply.ok(await deps.services.promotion.getFeatureFlags());
  });

  /**
   * 可领取的店铺券。
   *
   * 允许匿名访问（商品页要展示券条），登录后每个券上多一个 `collected` 标记。
   */
  app.get("/api/v1/store/vouchers", { preHandler: auth.customerAuth }, async (req, reply) => {
    const customerId = req.auth?.customerId ?? null;
    const channelId = await resolveChannelId(deps, req);
    const channel = await deps.services.regionChannel.getChannel(channelId);
    const items = await deps.services.promotion.listPublicVouchers(customerId);
    // 券面额是 minor unit，币种跟店铺走：前端不该自己猜 ¥
    reply.ok({ items, count: items.length, currency_code: channel.currency_code });
  });

  /**
   * 领取一张券。
   *
   * 必须登录：券要落到某个人的卡券包里。重复领取是幂等的（返回原码），
   * 顾客连点两下不该看到红字。
   */
  app.post(
    "/api/v1/store/vouchers/:id/collect",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const { id } = req.params as { id: string };
      const res = await deps.services.promotion.collectVoucher(id, customerId);
      reply.ok({ code: res.code, already_collected: res.alreadyCollected });
    },
  );

  /** 我的卡券：未用在前；结账页直接拿这里的 code 套用。 */
  app.get(
    "/api/v1/store/customer/vouchers",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const channelId = await resolveChannelId(deps, req);
      const channel = await deps.services.regionChannel.getChannel(channelId);
      const items = await deps.services.promotion.listCollectedVouchers(customerId);
      reply.ok({ items, count: items.length, currency_code: channel.currency_code });
    },
  );
}
