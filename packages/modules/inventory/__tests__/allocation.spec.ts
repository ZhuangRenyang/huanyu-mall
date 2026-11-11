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

describe("planAllocation（ADR-013 §1：优先单仓，不够才拆）", () => {
  it("单仓满足 → 只产生一条 allocation", () => {
    const plan = planAllocation([level("loc_a", 0, 10)], [{ variantId: "var_1", quantity: 3 }], itemByVariant);
    expect(plan).toEqual({
      ok: true,
      allocations: [{ variantId: "var_1", stockLocationId: "loc_a", quantity: 3 }],
    });
  });

  it("主仓不足、备用仓能整单满足 → 整单从备用仓发（不拆）", () => {
    const plan = planAllocation(
      [level("loc_main", 10, 2), level("loc_backup", 5, 5)],
      [{ variantId: "var_1", quantity: 3 }],
      itemByVariant,
    );
    expect(plan).toEqual({
      ok: true,
      allocations: [{ variantId: "var_1", stockLocationId: "loc_backup", quantity: 3 }],
    });
  });

  it("没有单仓能整单满足、但合计够 → 退回跨仓拆分", () => {
    const plan = planAllocation(
      [level("loc_main", 10, 2), level("loc_backup", 5, 2)],
      [{ variantId: "var_1", quantity: 3 }],
      itemByVariant,
    );
    expect(plan).toEqual({
      ok: true,
      allocations: [
        { variantId: "var_1", stockLocationId: "loc_main", quantity: 2 },
        { variantId: "var_1", stockLocationId: "loc_backup", quantity: 1 },
      ],
    });
  });

  it("合计仍不足 → 拒绝，available 为各仓合计", () => {
    const plan = planAllocation(
      [level("loc_main", 10, 2), level("loc_backup", 5, 2)],
      [{ variantId: "var_1", quantity: 5 }],
      itemByVariant,
    );
    expect(plan).toEqual({ ok: false, variantId: "var_1", requested: 5, available: 4 });
  });

  it("多个仓都能满足 → 选优先级最高的（大者优先）", () => {
    const plan = planAllocation(
      [level("loc_low", 1, 10), level("loc_high", 9, 10)],
      [{ variantId: "var_1", quantity: 2 }],
      itemByVariant,
    );
    expect(plan).toEqual({
      ok: true,
      allocations: [{ variantId: "var_1", stockLocationId: "loc_high", quantity: 2 }],
    });
  });

  it("同优先级按 order 升序：老仓先被选中", () => {
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

  it("同一 variant 多行 → 汇总需求后判断单仓是否够", () => {
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

  it("多 SKU：任一 SKU 在某仓不够，该仓就不能整单满足", () => {
    const multi = new Map([
      ["var_1", "invitem_1"],
      ["var_2", "invitem_2"],
    ]);
    const plan = planAllocation(
      [
        level("loc_main", 10, 5, "invitem_1"),
        level("loc_main", 10, 1, "invitem_2"), // 主仓 var_2 只有 1
        level("loc_backup", 5, 5, "invitem_1"),
        level("loc_backup", 5, 5, "invitem_2"),
      ],
      [
        { variantId: "var_1", quantity: 2 },
        { variantId: "var_2", quantity: 2 },
      ],
      multi,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.allocations).toEqual([
      { variantId: "var_1", stockLocationId: "loc_backup", quantity: 2 },
      { variantId: "var_2", stockLocationId: "loc_backup", quantity: 2 },
    ]);
  });

  it("变体无库存项映射 → 视为可用 0", () => {
    const plan = planAllocation([level("loc_a", 0, 10)], [{ variantId: "var_x", quantity: 1 }], itemByVariant);
    expect(plan).toEqual({ ok: false, variantId: "var_x", requested: 1, available: 0 });
  });

  it("空 items → 空分配", () => {
    expect(planAllocation([], [], itemByVariant)).toEqual({ ok: true, allocations: [] });
  });
});
