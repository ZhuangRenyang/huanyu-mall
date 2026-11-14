import type { AppDeps } from "../deps.js";

/**
 * 分销佣金的计提与作废（ADR-101）。
 *
 * 两条纪律：
 * 1. **只记账，不打款**：佣金进 pending 流水，结算由商家人工操作；
 * 2. **失败不阻断主流程**：确认收货、退款打款都是顾客关心的动作，
 *    佣金记账失败只记日志（可人工补记），不能把它们也报成失败。
 */

type Logger = { warn: (obj: unknown, msg?: string) => void };

/** 订单完成时计提佣金；无归因 / 自推 / 已计提 → 什么也不做。 */
export async function awardCommissionSafely(
  deps: AppDeps,
  log: Logger,
  order: {
    id: string;
    total_minor: bigint;
    affiliate_id?: string | null;
    customer_id: string | null;
  },
): Promise<void> {
  if (!order.affiliate_id) return;
  try {
    await deps.services.promotion.createCommissionForOrder({
      orderId: order.id,
      orderTotalMinor: order.total_minor,
      affiliateId: order.affiliate_id,
      buyerCustomerId: order.customer_id,
    });
  } catch (err) {
    log.warn({ err, orderId: order.id }, "计提分销佣金失败");
  }
}

/** 退款后作废佣金（已结算的不动，留给人工）。 */
export async function cancelCommissionSafely(
  deps: AppDeps,
  log: Logger,
  orderId: string,
  reason: string,
): Promise<void> {
  try {
    await deps.services.promotion.cancelCommissionByOrder(orderId, reason);
  } catch (err) {
    log.warn({ err, orderId }, "作废分销佣金失败");
  }
}
