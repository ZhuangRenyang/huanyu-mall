/**
 * 多仓分配算法（ADR-013 §1）：纯函数，不碰数据库、不抛领域错误。
 *
 * 规则：
 * 1. 仓按 priority **降序**（大者优先，与既有 `listLocations()` 的 ORDER BY priority DESC 一致）
 *    逐个扣减可用量；同优先级按调用方给的 `order`（仓库创建顺序）升序，老仓优先——
 *    保证默认仓不会被后来新建的同优先级仓抢走；
 * 2. 单行项可跨多仓 → 每条 allocation 一个 location；
 * 3. 任一 SKU 所有仓合计可用量不足 → 整单失败（ok:false），不留部分分配；
 * 4. 同一 variant 在 items 中出现多次时先按 variant 汇总需求量。
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

export function planAllocation(
  levels: LevelSnapshot[],
  items: AllocationItem[],
  itemIdByVariant: Map<string, string>,
): AllocationPlan {
  // 同一 variant 多行 → 汇总需求，避免第一行把库存吃光后第二行误判不足
  const needByVariant = new Map<string, number>();
  for (const item of items) {
    needByVariant.set(item.variantId, (needByVariant.get(item.variantId) ?? 0) + item.quantity);
  }

  const levelsByItem = new Map<string, LevelSnapshot[]>();
  for (const level of levels) {
    const list = levelsByItem.get(level.inventoryItemId) ?? [];
    list.push(level);
    levelsByItem.set(level.inventoryItemId, list);
  }
  // priority 降序（大者优先）；同优先级按 order 升序（老仓优先），最后按 locationId 兜底确定性
  for (const list of levelsByItem.values()) {
    list.sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.stockLocationId.localeCompare(b.stockLocationId),
    );
  }

  const allocations: PlannedAllocation[] = [];
  for (const [variantId, requested] of needByVariant) {
    const itemId = itemIdByVariant.get(variantId);
    const candidates = itemId ? (levelsByItem.get(itemId) ?? []) : [];
    let remaining = requested;
    for (const level of candidates) {
      if (remaining <= 0) break;
      if (level.availableQuantity <= 0) continue;
      const take = Math.min(remaining, level.availableQuantity);
      allocations.push({ variantId, stockLocationId: level.stockLocationId, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) {
      const available = candidates.reduce((sum, l) => sum + Math.max(0, l.availableQuantity), 0);
      return { ok: false, variantId, requested, available };
    }
  }

  return { ok: true, allocations };
}
