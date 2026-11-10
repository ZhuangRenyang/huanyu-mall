import { describe, expect, it } from "vitest";
import type { LevelSnapshot } from "../src/services/allocation.js";
import { planAllocation } from "../src/services/allocation.js";

const itemByVariant = new Map([["var_1", "invitem_1"]]);

function level(
  stockLocationId: string,
  priority: number,
  availableQuantity: number,
  inventoryItemId = "invitem_1",
  order = 0,
): LevelSnapshot {
  return { inventoryItemId, stockLocationId, priority, order, availableQuantity };
}

describe("planAllocation（ADR-013 §1：按 priority 贪心，可跨仓拆单）", () => {
  it("单仓满足 → 只产生一条 allocation", () => {
    const plan = planAllocation([level("loc_a", 0, 10)], [{ variantId: "var_1", quantity: 3 }], itemByVariant);
    expect(plan).toEqual({
      ok: true,
      allocations: [{ variantId: "var_1", stockLocationId: "loc_a", quantity: 3 }],
    });
  });

  it("跨两仓按 priority 降序拆分：大者先扣（与既有 listLocations DESC 一致）", () => {
    const plan = planAllocation(
      // 故意乱序传入，验证按 priority 降序排序
      [level("loc_b", 1, 4), level("loc_a", 2, 3)],
      [{ variantId: "var_1", quantity: 6 }],
      itemByVariant,
    );
    expect(plan).toEqual({
      ok: true,
      allocations: [
        { variantId: "var_1", stockLocationId: "loc_a", quantity: 3 },
        { variantId: "var_1", stockLocationId: "loc_b", quantity: 3 },
      ],
    });
  });

  it("同优先级按 order 升序：老仓先扣，默认仓不会被新仓抢走", () => {
    const plan = planAllocation(
      [level("loc_new", 0, 5, "invitem_1", 1), level("loc_old", 0, 5, "invitem_1", 0)],
      [{ variantId: "var_1", quantity: 2 }],
      itemByVariant,
    );
    expect(plan).toEqual({
      ok: true,
      allocations: [{ variantId: "var_1", stockLocationId: "loc_old", quantity: 2 }],
    });
  });

  it("单仓可用为 0 时跳过，继续用下一仓", () => {
    const plan = planAllocation(
      [level("loc_a", 0, 0), level("loc_b", 1, 5)],
      [{ variantId: "var_1", quantity: 2 }],
      itemByVariant,
    );
    expect(plan).toEqual({
      ok: true,
      allocations: [{ variantId: "var_1", stockLocationId: "loc_b", quantity: 2 }],
    });
  });

  it("合计不足 → ok:false，available 为各仓合计（整单失败）", () => {
    const plan = planAllocation(
      [level("loc_a", 0, 2), level("loc_b", 1, 3)],
      [{ variantId: "var_1", quantity: 6 }],
      itemByVariant,
    );
    expect(plan).toEqual({ ok: false, variantId: "var_1", requested: 6, available: 5 });
  });

  it("同一 variant 多行 → 汇总需求后分配，不会因两行分开判断而误判", () => {
    const plan = planAllocation(
      [level("loc_a", 0, 5)],
      [
        { variantId: "var_1", quantity: 3 },
        { variantId: "var_1", quantity: 2 },
      ],
      itemByVariant,
    );
    expect(plan).toEqual({
      ok: true,
      allocations: [{ variantId: "var_1", stockLocationId: "loc_a", quantity: 5 }],
    });
  });

  it("变体无库存项映射 → 视为可用 0", () => {
    const plan = planAllocation([level("loc_a", 0, 10)], [{ variantId: "var_x", quantity: 1 }], itemByVariant);
    expect(plan).toEqual({ ok: false, variantId: "var_x", requested: 1, available: 0 });
  });
});
