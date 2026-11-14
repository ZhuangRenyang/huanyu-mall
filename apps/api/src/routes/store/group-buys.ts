import type { FastifyInstance } from "fastify";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/**
 * 店面拼团（ADR-100）。
 *
 * 三个动作：看进行中的活动、参团、成团后领券。
 * 参团不需要付款，也不生成订单 —— 领到券后走正常下单流程。
 */
export function storeGroupBuyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  /** 进行中的拼团（游客可见）。 */
  app.get("/api/v1/store/group-buys", async (_req, reply) => {
    reply.ok({ items: await deps.services.promotion.listActiveGroupBuys() });
  });

  /** 参团：登录必需（团要挂到人头上，成团后才知道给谁发券）。 */
  app.post(
    "/api/v1/store/group-buys/:id/join",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const customerId = req.auth?.customerId;
      if (!customerId) throw errors.unauthenticated();
      const res = await deps.services.promotion.joinGroupBuy(id, customerId);
      reply.ok({
        team: res.team,
        joined: res.joined,
      });
    },
  );

  /** 我的拼团：活动信息 + 团状态 + 是否已成团（成团才可领券）。 */
  app.get("/api/v1/store/group-buys/mine", { preHandler: auth.customerAuth }, async (req, reply) => {
    const customerId = req.auth?.customerId;
    if (!customerId) throw errors.unauthenticated();
    const items = await deps.services.promotion.listMyGroupBuys(customerId);
    reply.ok({ items });
  });

  /** 成团后领拼团券（幂等：重复领返回同一张码）。 */
  app.post(
    "/api/v1/store/group-buys/:id/voucher",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const customerId = req.auth?.customerId;
      if (!customerId) throw errors.unauthenticated();
      const res = await deps.services.promotion.claimGroupBuyVoucher(id, customerId);
      reply.ok({ code: res.code, already_collected: res.already_collected });
    },
  );
}
