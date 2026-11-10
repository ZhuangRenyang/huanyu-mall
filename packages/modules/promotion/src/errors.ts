import { DomainError } from "@mall/core";

/** M-promotion 模块错误（code 对齐架构 §7.4：3xxxx 领域状态 / 5xxxx 系统）。 */

export function promotionNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Promotion not found: ${id}` });
}

export function promotionRuleNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Promotion rule not found: ${id}` });
}

export function voucherNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Voucher not found: ${id}` });
}

export function voucherCodeNotFound(code: string): DomainError {
  return new DomainError({ code: 30001, message: `Voucher code not found: ${code}` });
}

export function giftCardNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Gift card not found: ${id}` });
}

export function giftCardInsufficientBalance(id: string): DomainError {
  return new DomainError({ code: 30003, message: `Gift card has insufficient balance: ${id}` });
}

export function giftCardExpired(id: string): DomainError {
  return new DomainError({ code: 30002, message: `Gift card has expired: ${id}` });
}

export function giftCardInactive(id: string): DomainError {
  return new DomainError({ code: 30002, message: `Gift card is inactive: ${id}` });
}

export function voucherExpired(id: string): DomainError {
  return new DomainError({ code: 30002, message: `Voucher has expired: ${id}` });
}

export function voucherUsageLimitReached(code: string): DomainError {
  return new DomainError({ code: 30002, message: `Voucher usage limit reached: ${code}` });
}
