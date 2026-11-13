import { DomainError } from "@mall/core";
import type { OrderStatus } from "../types.js";

/**
 * 订单状态机（表驱动纯函数）。
 *
 * 正常链路：pending → awaiting_payment → paid → partially_fulfilled → fulfilled → delivered → completed。
 * 退款链路（对齐淘宝）：任意已付款状态 → **refund_pending（退款中）** → refunded（同意）
 *   或回到申请前的状态（拒绝/撤销）。
 *
 * refund_pending 是审核期的闸门：
 *   - 订单在这期间**不能发货**（否则货已发出、钱也退了）；
 *   - 不能取消订单（退款单还在审核，两条路会打架）。
 *
 * refund_pending 的出边包含所有已付款状态，因为拒绝退款要精确恢复到申请前的状态
 * （已发货的回「已发货」，未发货的回「待发货」）——具体回哪个由
 * refund_request.order_status_before 决定，不是状态机自己猜。
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["awaiting_payment", "canceled"],
  awaiting_payment: ["paid", "canceled"],
  paid: ["partially_fulfilled", "fulfilled", "refund_pending"],
  partially_fulfilled: ["fulfilled", "refund_pending"],
  // 顾客确认收货可直接完成（delivered 是承运商签收回调，不是必经步骤）
  fulfilled: ["delivered", "completed", "refund_pending"],
  delivered: ["completed", "refund_pending"],
  completed: ["refund_pending"],
  canceled: [],
  refund_pending: [
    "refunded",
    // 拒绝/撤销退款后恢复原状态（服务层按 order_status_before 精确回滚）
    "paid",
    "partially_fulfilled",
    "fulfilled",
    "delivered",
    "completed",
  ],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError({ code: 30002, message: `订单状态不允许从 ${from} 迁移到 ${to}` });
  }
}

/** 可发起（全额）退款的状态：已付款且尚未进入退款审核。 */
export function isRefundable(status: OrderStatus): boolean {
  return TRANSITIONS[status]?.includes("refund_pending") ?? false;
}

/**
 * 能申请「退货退款」的订单状态 = 货已经在路上或已到手。
 *
 * 未发货（paid / partially_fulfilled 的部分）只能「仅退款」：
 * 买家手里没货可寄，进了「待买家寄回」就永远走不出来。
 * partially_fulfilled 算已发货 —— 部分发出时，顾客收到的那部分可以退。
 */
export function supportsReturnRefund(status: OrderStatus): boolean {
  return (
    status === "partially_fulfilled" ||
    status === "fulfilled" ||
    status === "delivered" ||
    status === "completed"
  );
}

/**
 * 该状态是否还能发货。
 *
 * 退款审核中禁止发货 —— 这是「人工审核」真正生效的地方：
 * 只把状态显示成「退款中」但照样能发货，等于没拦住。
 */
export function isShippable(status: OrderStatus): boolean {
  return status === "paid" || status === "partially_fulfilled";
}
