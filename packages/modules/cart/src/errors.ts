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
