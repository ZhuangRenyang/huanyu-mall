import { describe, expect, it } from "vitest";
import { evalPredicate } from "../src/services/predicate.js";
import type { PredicateContext } from "../src/services/predicate.js";

const ctx = (over: Partial<PredicateContext> = {}): PredicateContext => ({
  variantId: "var_1",
  categoryIds: ["cat_1", "cat_2"],
  subtotalMinor: 10000n,
  currencyCode: "CNY",
  ...over,
});

describe("evalPredicate（纯函数，六种分支）", () => {
  it("variantIds：命中 / 未命中", () => {
    expect(evalPredicate({ variantIds: ["var_1", "var_2"] }, ctx())).toBe(true);
    expect(evalPredicate({ variantIds: ["var_2"] }, ctx())).toBe(false);
  });

  it("categoryIds：交集命中 / 未命中", () => {
    expect(evalPredicate({ categoryIds: ["cat_2"] }, ctx())).toBe(true);
    expect(evalPredicate({ categoryIds: ["cat_9"] }, ctx())).toBe(false);
  });

  it("and：全真才真", () => {
    const p = { and: [{ variantIds: ["var_1"] }, { categoryIds: ["cat_1"] }] } as const;
    expect(evalPredicate(p, ctx())).toBe(true);
    const p2 = { and: [{ variantIds: ["var_1"] }, { categoryIds: ["cat_9"] }] } as const;
    expect(evalPredicate(p2, ctx())).toBe(false);
  });

  it("or：任一真即真", () => {
    const p = { or: [{ variantIds: ["var_9"] }, { categoryIds: ["cat_1"] }] } as const;
    expect(evalPredicate(p, ctx())).toBe(true);
    const p2 = { or: [{ variantIds: ["var_9"] }, { categoryIds: ["cat_9"] }] } as const;
    expect(evalPredicate(p2, ctx())).toBe(false);
  });

  it("嵌套 and/or 组合", () => {
    const p = {
      and: [
        { or: [{ variantIds: ["var_1"] }, { variantIds: ["var_2"] }] },
        { categoryIds: ["cat_1"] },
      ],
    } as const;
    expect(evalPredicate(p, ctx())).toBe(true);
  });

  it("subtotalGte：小计门槛（bigint，禁浮点）", () => {
    expect(evalPredicate({ subtotalGte: 10000 }, ctx())).toBe(true);
    expect(evalPredicate({ subtotalGte: 10001 }, ctx())).toBe(false);
  });

  it("currencyEq：币种匹配", () => {
    expect(evalPredicate({ currencyEq: "CNY" }, ctx())).toBe(true);
    expect(evalPredicate({ currencyEq: "USD" }, ctx())).toBe(false);
  });

  it("collectionIds：无 collection 上下文恒 false（不误命中）", () => {
    expect(evalPredicate({ collectionIds: ["col_1"] }, ctx())).toBe(false);
  });
});
