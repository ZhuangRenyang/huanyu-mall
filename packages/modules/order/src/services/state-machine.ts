import { DomainError } from "@mall/core";
import type { OrderStatus } from "../types.js";

/**
 * 订单状态机（表驱动纯函数）。
 * 一期：pending → awaiting_payment → paid → partially_fulfilled → fulfilled → delivered；全额退款到 refunded。
 * partially_fulfilled：拆单订单发了一部分（至少一个仓已发、但未发完）。
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["awaiting_payment", "canceled"],
  awaiting_payment: ["paid", "canceled"],
  paid: ["partially_fulfilled", "fulfilled", "refunded"],
  partially_fulfilled: ["fulfilled", "refunded"],
  fulfilled: ["delivered", "refunded"],
  delivered: ["completed", "refunded"],
  completed: ["refunded"],
  canceled: [],
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

/** 可发起（全额）退款的状态。 */
export function isRefundable(status: OrderStatus): boolean {
  return TRANSITIONS[status]?.includes("refunded") ?? false;
}
