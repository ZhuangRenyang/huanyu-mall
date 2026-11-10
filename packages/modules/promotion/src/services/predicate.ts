import type { PromotionPredicate } from "../types.js";

/**
 * predicate 求值上下文（纯函数入参，便于单测覆盖所有分支）。
 * 目录促销只用 variantIds/categoryIds；subtotalGte/currencyEq 供阶段 3 订单促销复用。
 * collectionIds 依赖 collection 上下文，本契约不传（见 evalPredicate 内注释）。
 */
export interface PredicateContext {
  variantId: string;
  categoryIds: string[];
  /** 订单级小计（minor unit），subtotalGte 用。 */
  subtotalMinor: bigint;
  currencyCode: string;
}

/**
 * 类型化 JSON predicate 求值（ADR-012 §2）。纯函数，金额一律 bigint，禁浮点。
 * 支持六种分支：and / or / variantIds / categoryIds / subtotalGte / currencyEq。
 */
export function evalPredicate(predicate: PromotionPredicate, ctx: PredicateContext): boolean {
  if ("and" in predicate) {
    return predicate.and.every((p) => evalPredicate(p, ctx));
  }
  if ("or" in predicate) {
    return predicate.or.some((p) => evalPredicate(p, ctx));
  }
  if ("variantIds" in predicate) {
    return predicate.variantIds.includes(ctx.variantId);
  }
  if ("categoryIds" in predicate) {
    return predicate.categoryIds.some((id) => ctx.categoryIds.includes(id));
  }
  if ("collectionIds" in predicate) {
    // collectionIds 需要 collection 上下文，当前 computeDiscounts 契约不传 collection。
    // 恒 false（保留分支以对齐 ADR 的 7 种谓词，避免误判命中）。后续引入 collection 再扩展 ctx。
    void predicate.collectionIds;
    return false;
  }
  if ("subtotalGte" in predicate) {
    return ctx.subtotalMinor >= BigInt(predicate.subtotalGte);
  }
  if ("currencyEq" in predicate) {
    return ctx.currencyCode === predicate.currencyEq;
  }
  return false;
}
