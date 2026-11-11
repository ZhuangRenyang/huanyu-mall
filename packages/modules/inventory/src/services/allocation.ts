/**
 * 多仓分配算法（ADR-013 §1，2026-11-11 用户决策：**优先单仓，不够才拆**）。
 * 纯函数，不碰数据库、不抛领域错误。
 *
 * 规则（两段式）：
 * 1. **先找能整单满足的仓**：按 priority 降序（大者优先，与 listLocations 一致）
 *    挑第一个能一次性满足所有 SKU 需求的仓；同优先级按 order 升序（老仓优先）。
 *    命中时一单只产生 1 条预留、1 张发货单——这是绝大多数订单的路径。
 * 2. **找不到才拆单**：退化为按优先级贪心扣减，可从多个仓凑；
 *    此时一单会产生多条预留、多张发货单。
 * 3. 合计仍不足 → 整单失败；`available` 返回各仓合计（因为允许拆，合计才是有意义的上限）。
 *
 * 为什么不是纯单仓：两仓各一半、凑起来够的订单会被直接拒掉，白白丢单。
 * 为什么不是纯拆单：日常订单动不动就拆成两个包裹，发货、运费、客服都变复杂。
 */

export interface AllocationItem {
  variantId: string;
  quantity: number;
}

export interface LevelSnapshot {
  inventoryItemId: string;
  stockLocationId: string;
  /** 大者优先（与既有 listLocations 的 priority DESC 一致）。 */
  priority: number;
  /** 同优先级的次序（仓库创建顺序，老仓在前），由调用方按 listLocations 顺序给。 */
  order?: number;
  availableQuantity: number;
}

export interface PlannedAllocation {
  variantId: string;
  stockLocationId: string;
  quantity: number;
}

export type AllocationPlan =
  | { ok: true; allocations: PlannedAllocation[] }
  | { ok: false; variantId: string; requested: number; available: number };

interface LocationBucket {
  stockLocationId: string;
  priority: number;
  order: number;
  availableByItem: Map<string, number>;
}

export function planAllocation(
  levels: LevelSnapshot[],
  items: AllocationItem[],
  itemIdByVariant: Map<string, string>,
): AllocationPlan {
  // 同一 variant 多行 → 汇总需求
  const needByVariant = new Map<string, number>();
  for (const item of items) {
    needByVariant.set(item.variantId, (needByVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  if (needByVariant.size === 0) return { ok: true, allocations: [] };

  // 按仓聚合可用量
  const buckets = new Map<string, LocationBucket>();
  for (const level of levels) {
    const bucket = buckets.get(level.stockLocationId) ?? {
      stockLocationId: level.stockLocationId,
      priority: level.priority,
      order: level.order ?? 0,
      availableByItem: new Map<string, number>(),
    };
    bucket.availableByItem.set(level.inventoryItemId, level.availableQuantity);
    buckets.set(level.stockLocationId, bucket);
  }
  const ordered = [...buckets.values()].sort(
    (a, b) =>
      b.priority - a.priority ||
      a.order - b.order ||
      a.stockLocationId.localeCompare(b.stockLocationId),
  );

  const availableFor = (loc: LocationBucket, variantId: string): number => {
    const itemId = itemIdByVariant.get(variantId);
    return itemId ? (loc.availableByItem.get(itemId) ?? 0) : 0;
  };

  // —— 第一段：优先单仓整单满足 ——
  for (const loc of ordered) {
    const fits = [...needByVariant].every(([variantId, needed]) => availableFor(loc, variantId) >= needed);
    if (!fits) continue;
    return {
      ok: true,
      allocations: [...needByVariant].map(([variantId, quantity]) => ({
        variantId,
        stockLocationId: loc.stockLocationId,
        quantity,
      })),
    };
  }

  // —— 第二段：没有单仓够，退化为跨仓拆分（按优先级贪心） ——
  const allocations: PlannedAllocation[] = [];
  for (const [variantId, requested] of needByVariant) {
    let remaining = requested;
    let total = 0;
    for (const loc of ordered) {
      const available = availableFor(loc, variantId);
      total += available;
      if (remaining <= 0 || available <= 0) continue;
      const take = Math.min(remaining, available);
      allocations.push({ variantId, stockLocationId: loc.stockLocationId, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) {
      return { ok: false, variantId, requested, available: total };
    }
  }
  return { ok: true, allocations };
}
