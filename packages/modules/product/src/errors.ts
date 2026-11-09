import { DomainError } from "@mall/core";

/** M01 模块错误（code 对齐架构 §7.4）。 */
export function productNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Product not found: ${id}` });
}

export function variantNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Variant not found: ${id}` });
}
