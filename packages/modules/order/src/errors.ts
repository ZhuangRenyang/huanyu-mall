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

// ---------------------------------------------------------------- *
// 退款申请单
// ---------------------------------------------------------------- *

export function refundRequestNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `退款申请不存在：${id}` });
}

/** 同一订单同时只能有一条待处理申请：否则商家可能重复退款。 */
export function refundAlreadyPending(orderId: string): DomainError {
  return new DomainError({ code: 30002, message: `订单 ${orderId} 已有待处理的退款申请` });
}

/** 已处理过的申请不能再处理一次（防双击重复退款）。 */
export function refundAlreadyReviewed(status: string): DomainError {
  return new DomainError({ code: 30002, message: `该退款申请已处理（当前状态：${status}）` });
}

export function refundReviewNoteRequired(): DomainError {
  return new DomainError({ code: 20001, message: "拒绝退款必须填写理由" });
}

/**
 * 售后类型与操作不匹配（ADR-051）。
 *
 * 两种典型误用：
 *   - 未发货订单申请「退货退款」（买家没货可寄）；
 *   - 对「退货退款」直接调同意打款（货没回来钱先走）。
 */
export function refundResolutionMismatch(reason: string): DomainError {
  return new DomainError({ code: 30002, message: `售后类型不匹配：${reason}` });
}

/** 换货缺少目标规格（ADR-090）。 */
export function exchangeTargetRequired(reason: string): DomainError {
  return new DomainError({ code: 20001, message: reason });
}

/** 退货物流信息不完整（公司或单号为空）。 */
export function returnShipmentInvalid(reason: string): DomainError {
  return new DomainError({ code: 20001, message: reason });
}

// ---------------------------------------------------------------- *
// 发票（ADR-098）
// ---------------------------------------------------------------- *

export function invoiceNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `发票申请不存在：${id}` });
}

/** 未付款订单不能开票：开了票又要退款，票得红冲，两头都麻烦。 */
export function invoiceNotAllowed(reason: string): DomainError {
  return new DomainError({ code: 30002, message: `不能开票：${reason}` });
}

/** 一张订单只能申请一次开票。 */
export function invoiceAlreadyRequested(orderId: string): DomainError {
  return new DomainError({ code: 30002, message: `订单 ${orderId} 已提交过开票申请` });
}

/** 发票单已处理过（防双击重复开票）。 */
export function invoiceAlreadyReviewed(status: string): DomainError {
  return new DomainError({ code: 30002, message: `该发票申请已处理（当前状态：${status}）` });
}

export function invoiceTitleRequired(): DomainError {
  return new DomainError({ code: 20001, message: "请填写发票抬头" });
}

/** 企业发票必须填税号：没有税号的增值税发票不能报销。 */
export function invoiceTaxIdRequired(): DomainError {
  return new DomainError({ code: 20001, message: "企业发票必须填写税号" });
}

export function invoiceNoRequired(): DomainError {
  return new DomainError({ code: 20001, message: "请填写发票号码" });
}

/** 拒绝开票必须填原因（顾客要知道为什么开不了）。 */
export function invoiceReviewNoteRequired(): DomainError {
  return new DomainError({ code: 20001, message: "拒绝开票必须填写原因" });
}
