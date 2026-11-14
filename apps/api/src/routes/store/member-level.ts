import type { FastifyInstance } from "fastify";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/**
 * 我的会员等级（ADR-102）。
 *
 * 只读：当前等级、累计消费、下一档还差多少。
 * 等级不落库 —— 每次按累计消费实时匹配，规则改了立刻生效。
 */
export function storeMemberLevelRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  app.get("/api/v1/store/member-level", { preHandler: auth.customerAuth }, async (req, reply) => {
    const customerId = req.auth?.customerId;
    if (!customerId) throw errors.unauthenticated();

    const [sums, levels] = await Promise.all([
      deps.services.order.summarizeByCustomerIds([customerId]),
      deps.services.customer.listMemberLevels(),
    ]);
    const spent = sums[0]?.total_spent_minor ?? 0n;

    // 当前档：满足门槛的最高一档
    let current = null as (typeof levels)[number] | null;
    let next = null as (typeof levels)[number] | null;
    for (const level of levels) {
      if (spent >= level.threshold_minor) current = level;
      else {
        next = level;
        break;
      }
    }

    reply.ok({
      level: current,
      /** 累计消费（minor）：等级判定依据，与后台客户列表同一口径。 */
      spent_minor: spent,
      next: next
        ? {
            name: next.name,
            threshold_minor: next.threshold_minor,
            gap_minor: next.threshold_minor - spent,
            discount_bps: next.discount_bps,
          }
        : null,
    });
  });
}
