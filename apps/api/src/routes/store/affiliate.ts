import type { FastifyInstance } from "fastify";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/**
 * 我的推广（ADR-101）。
 *
 * 推广员自己看：推广码、待结算/已结算金额、最近流水。
 * 只读 —— 结算由商家在后台人工操作，顾客侧没有任何「提现」入口
 * （那会变成一条无人值守的打款路径）。
 */
export function storeAffiliateRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  app.get("/api/v1/store/affiliate/me", { preHandler: auth.customerAuth }, async (req, reply) => {
    const customerId = req.auth?.customerId;
    if (!customerId) throw errors.unauthenticated();

    const summary = await deps.services.promotion.getAffiliateSummary(customerId);
    if (!summary.affiliate) {
      // 不是推广员：明确返回 null，前端据此显示「开通方式请联系商家」
      return reply.ok({ affiliate: null, pending_minor: 0, settled_minor: 0, items: [] });
    }
    const commissions = await deps.services.promotion.listCommissions({
      affiliateId: summary.affiliate.id,
      limit: 20,
      offset: 0,
    });
    reply.ok({
      affiliate: summary.affiliate,
      pending_minor: summary.pending_minor,
      settled_minor: summary.settled_minor,
      items: commissions.items,
    });
  });
}
