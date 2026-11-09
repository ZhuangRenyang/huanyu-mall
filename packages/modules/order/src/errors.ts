import { DomainError } from "@mall/core";

/** M05 模块错误（code 对齐架构 §7.4）。 */
export function orderNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Order not found: ${id}` });
}

export function refundNotAllowed(reason: string): DomainError {
  return new DomainError({ code: 30002, message: `Refund not allowed: ${reason}` });
}

export function partialRefundNotSupported(): DomainError {
  // K4：一期只开全额退款，部分退款路径结构保留但禁止。
  return new DomainError({ code: 30002, message: "Partial refund not supported (full refund only)" });
}
