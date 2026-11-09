import { DomainError } from "@mall/core";

/** M02 模块错误（code 对齐架构 §7.4）。 */
export function priceSetNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Price set not found: ${id}` });
}
