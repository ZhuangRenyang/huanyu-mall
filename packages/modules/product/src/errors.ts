import { DomainError } from "@mall/core";

/** M01 模块错误（code 对齐架构 §7.4）。 */
export function productNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Product not found: ${id}` });
}

export function variantNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Variant not found: ${id}` });
}

// ---------------------------------------------------------------- *
// 分类（ADR-028）
// ---------------------------------------------------------------- *

export function categoryNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `分类不存在：${id}` });
}

export function categoryHandleTaken(handle: string): DomainError {
  return new DomainError({ code: 30002, message: `分类标识已被占用：${handle}` });
}

/** 只做两级：淘宝那种多级类目对自建店铺是过度设计，先把「一级 → 二级」做扎实。 */
export function categoryNestingTooDeep(): DomainError {
  return new DomainError({ code: 20001, message: "分类最多两级：二级分类下不能再建子分类" });
}

export function categoryCannotBeOwnParent(): DomainError {
  return new DomainError({ code: 20001, message: "不能把分类挂到自己或自己的子分类下" });
}

export function categoryHasChildren(count: number): DomainError {
  return new DomainError({
    code: 30003,
    message: `该分类下还有 ${count} 个子分类，请先删除或移走它们`,
  });
}

export function categoryHasProducts(count: number): DomainError {
  return new DomainError({
    code: 30003,
    message: `该分类下还有 ${count} 个商品，请先把商品移到别的分类`,
  });
}
