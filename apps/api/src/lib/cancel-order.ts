import { orderCancelWorkflow } from "@mall/workflows";
import type { AppDeps } from "../deps.js";

/**
 * 取消订单并释放库存预留（ADR-075）。
 *
 * 为什么不是一句 `order.cancelOrder(id)`：取消订单**必须把占用的库存还回去**。
 * 只改状态的话，预留一直挂在 `reserved` 上，可用量永远少这几件 ——
 * 顾客看到「有货」却下不了单，是看不见的库存泄漏。
 *
 * 两件事谁先谁后：
 * 1. 先跑 `orderCancelWorkflow`（工作流第一步取消订单、第二步释放预留）；
 * 2. 工作流返回后再落一次状态 —— `cancelOrder` 对已取消是幂等的空操作。
 *    这一步不是冗余：释放步骤抛错重试时，状态必须已经是终态，
 *    否则「货已放回、单还挂着」会被继续下单。
 *
 * 释放走 `releaseReservationIfReserved`：工作流重试时前一批可能已释放，
 * 用非幂等版本会在第一条上抛错，整次重试永远失败。
 */
export async function cancelOrderAndReleaseStock(
  deps: AppDeps,
  orderId: string,
): Promise<void> {
  const reservations = await deps.services.inventory.listReservationsByOrder(orderId);
  // 只放还在占用的；已释放/已提交的不用再动
  const reservationIds = reservations
    .filter((r) => r.status === "reserved")
    .map((r) => r.id);

  await deps.workflow.run(
    orderCancelWorkflow,
    { orderId, reservationIds },
    // 同一单重复取消（连点两次 / 重试）不重复释放
    { idempotencyKey: `order-cancel:${orderId}` },
  );

  await deps.services.order.cancelOrder(orderId);
}
