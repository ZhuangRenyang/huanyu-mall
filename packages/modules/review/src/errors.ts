import { DomainError } from "@mall/core";

/**
 * 评价模块错误码。
 *
 * 区间：2xxxx → 400（入参/前置条件不满足），300xx → 409/404（资源状态冲突）。
 * 与既有模块保持同一套映射（packages/core/src/errors/http-status.ts）。
 */

export function reviewOrderNotFound(orderId: string): DomainError {
  return new DomainError({ code: 30001, message: `订单不存在：${orderId}` });
}

/** 不是自己的订单：与「不存在」区分开会更方便排查，但对外暴露他人订单号同样不合适。 */
export function reviewNotOrderOwner(): DomainError {
  return new DomainError({ code: 10003, message: "只能评价自己买过的商品" });
}

/** 订单还没收货（淘宝同样是「确认收货后才能评价」）。 */
export function orderNotReviewable(status: string): DomainError {
  return new DomainError({
    code: 20001,
    message: `订单当前状态（${status}）不能评价，确认收货后再来`,
  });
}

export function productNotInOrder(): DomainError {
  return new DomainError({ code: 20002, message: "该商品不在这笔订单里" });
}

export function invalidRating(): DomainError {
  return new DomainError({ code: 20003, message: "评分必须是 1–5 星" });
}

export function reviewContentTooLong(max: number): DomainError {
  return new DomainError({ code: 20004, message: `评价内容最多 ${max} 字` });
}

/** 一单一商品只能评一次。 */
export function alreadyReviewed(): DomainError {
  return new DomainError({ code: 30002, message: "这笔订单的这个商品已经评价过了" });
}

export function reviewNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `评价不存在：${id}` });
}
