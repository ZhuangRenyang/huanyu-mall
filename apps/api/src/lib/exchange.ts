import type { AppDeps } from "../deps.js";

/**
 * 换货的库存预留与发货（ADR-090）。
 *
 * 换货不涉及钱，但涉及**货**：同意换货时要先把换出商品占住，否则商家确认收到
 * 退回后可能已经无货可发。这里复用 inventory.allocateAndReserve —— 与订单发货
 * 同一条原子扣减链路，只是把租约键换成申请单 id（`orderId` 传 `rfr_...`），
 * 这样换货的预留不会和原订单自己的预留混在一起。
 */

/** 同意换货：先预留换出商品，再推进单据；预留失败则整单报错，不留半拉子状态。 */
export async function approveExchange(deps: AppDeps, request: {
  id: string;
  exchange_variant_id: string | null;
  exchange_quantity: number;
}): Promise<void> {
  const variantId = request.exchange_variant_id;
  if (!variantId) throw new Error("换货缺少目标规格");
  const quantity = Math.max(1, request.exchange_quantity ?? 1);

  await deps.services.inventory.allocateAndReserve({
    orderId: request.id,
    items: [{ variantId, quantity }],
  });

  // 预留成功后推进单据；若单据推进失败（状态已变等），把预留还回去
  try {
    await deps.services.order.agreeExchangeRequest(request.id);
  } catch (err) {
    await releaseExchangeReservation(deps, request.id);
    throw err;
  }
}

/** 发出换货：先落单据（换出物流 + 完结），再 commit 预留把货真正扣掉。 */
export async function shipExchange(
  deps: AppDeps,
  request: { id: string },
  input: { carrier: string; trackingNumber: string },
): Promise<void> {
  const after = await deps.services.order.shipExchange(request.id, input);
  // 单据已落定，commit 预留；这里幂等失败可重试（commit 已扣的不会扣第二次）
  const reservations = await deps.services.inventory.listReservationsByOrder(request.id);
  for (const r of reservations) {
    if (r.status === "reserved") await deps.services.inventory.commitReservation(r.id);
  }
  void after;
}

/** 换货被拒绝/撤销：释放为换出商品预留的库存。 */
export async function releaseExchangeReservation(deps: AppDeps, requestId: string): Promise<void> {
  const reservations = await deps.services.inventory.listReservationsByOrder(requestId);
  for (const r of reservations) {
    if (r.status === "reserved") await deps.services.inventory.releaseReservationIfReserved(r.id);
  }
}
