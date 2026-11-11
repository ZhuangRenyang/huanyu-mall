import { DomainError } from "@mall/core";

/** M04 模块错误（code 对齐架构 §7.4）。 */
export function cartNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Cart not found: ${id}` });
}

export function lineItemNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Cart line item not found: ${id}` });
}

export function invalidQuantity(): DomainError {
  return new DomainError({ code: 20001, message: "Quantity must be a positive integer" });
}

export function priceNotFound(variantId: string): DomainError {
  return new DomainError({ code: 30003, message: `No price for variant: ${variantId}` });
}

export function variantNotSellable(variantId: string): DomainError {
  return new DomainError({ code: 30003, message: `Variant not sellable: ${variantId}` });
}

export function shippingOptionNotFound(id: string): DomainError {
  return new DomainError({ code: 30003, message: `Shipping option not found: ${id}` });
}

/** 收件国家缺失：税与运费都按国家算，没有国家不能出价（ADR-019）。 */
export function shippingCountryRequired(): DomainError {
  return new DomainError({ code: 40001, message: "请先填写收货国家/地区" });
}

/** 国家码非法：只接受 ISO 两位字母（CN / US）。 */
export function invalidShippingCountry(code: string): DomainError {
  return new DomainError({
    code: 40002,
    message: `国家/地区码不合法：${code}（需两位字母，如 CN / US）`,
  });
}
