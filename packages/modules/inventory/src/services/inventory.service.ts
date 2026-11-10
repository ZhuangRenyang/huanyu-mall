import {
  insufficientStock,
  invalidQuantity,
  inventoryItemNotFound,
  levelNotFound,
  reservationNotFound,
  reservationStateInvalid,
} from "../errors.js";
import { planAllocation, type LevelSnapshot } from "./allocation.js";
import type {
  AllocateAndReserveInput,
  AllocateAndReserveResult,
  AllocationSpec,
  AvailabilityDTO,
  IInventoryModuleService,
  InventoryLevelDTO,
  InventoryRepository,
  ReservationDTO,
  ReserveInput,
} from "../types.js";

/**
 * M07 对外门面。K1 硬约束：reservation 独立记账（reserved_quantity 与 reservation_item 双向维护），
 * 绝不简化成「下单即扣库存」；available = stocked - reserved，超卖直接拒绝。
 *
 * 并发硬约束（ADR-013 §2）：占用/释放/出库/调整一律走「条件或增量的单条 UPDATE」，
 * 绝不先读 available 再写绝对值（并发下会丢更新 → 超卖）。
 */
export class InventoryService implements IInventoryModuleService {
  constructor(private readonly repo: InventoryRepository) {}

  async listInventoryItems(q: { limit: number; offset: number }): Promise<{
    items: import("../types.js").InventoryItemDTO[];
    count: number;
  }> {
    return this.repo.listItems(q);
  }

  /** 可用仓库列表（按 priority 降序）。 */
  async listStockLocations(): Promise<import("../types.js").StockLocationDTO[]> {
    return this.repo.listLocations();
  }

  /** 按订单查未释放的预留 id（发货转出库用）。 */
  async listReservationsByOrder(orderId: string): Promise<string[]> {
    return this.repo.reservationIdsByOrder(orderId);
  }

  async getAvailability(input: {
    variantIds: string[];
    locationIds?: string[];
  }): Promise<AvailabilityDTO[]> {
    if (input.variantIds.length === 0) return [];
    const itemByVariant = await this.repo.itemIdsByVariantIds(input.variantIds);
    const itemIds = [...new Set(itemByVariant.values())];
    const levels = await this.repo.findLevelsByItemIds(itemIds);
    const scoped = input.locationIds
      ? levels.filter((l) => input.locationIds!.includes(l.stock_location_id))
      : levels;

    const availByItem = new Map<string, number>();
    for (const level of scoped) {
      availByItem.set(
        level.inventory_item_id,
        (availByItem.get(level.inventory_item_id) ?? 0) + level.available_quantity,
      );
    }
    return input.variantIds.map((variantId) => {
      const itemId = itemByVariant.get(variantId);
      return { variantId, available: itemId ? (availByItem.get(itemId) ?? 0) : 0 };
    });
  }

  /**
   * 整单分配 + 预留（ADR-013 §1/§2）：
   * 1) 同 orderId 已有未释放预留 → 直接返回（workflow 重放不重复扣减）；
   * 2) 取「变体 → 库存项 → 各仓可用量」快照，用纯函数 planAllocation 按 priority 贪心拆分；
   * 3) 任一 SKU 合计不足 → 抛 insufficientStock，整单失败、不留部分预留；
   * 4) 单事务内逐条条件 UPDATE 占用 + 写 reservation_item；任一抢占失败 → 抛错回滚。
   */
  async allocateAndReserve(input: AllocateAndReserveInput): Promise<AllocateAndReserveResult> {
    for (const item of input.items) assertQuantity(item.variantId, item.quantity);
    if (input.items.length === 0) return { reservationIds: [], allocations: [] };

    return this.repo.withTransaction(async (repo) => {
      const variantIds = [...new Set(input.items.map((i) => i.variantId))];
      const itemByVariant = await repo.itemIdsByVariantIds(variantIds);

      const existing = await repo.findReservationsByOrder(input.orderId);
      if (existing.length > 0) {
        return {
          reservationIds: existing.map((r) => r.id),
          allocations: allocationsFromReservations(existing, itemByVariant, input.orderId),
        };
      }

      for (const variantId of variantIds) {
        if (!itemByVariant.has(variantId)) throw inventoryItemNotFound(variantId);
      }
      const itemIds = [...new Set([...itemByVariant.values()])];
      const levels = await repo.findLevelsByItemIds(itemIds);
      const locations = await repo.listLocations();
      const priorityByLocation = new Map(locations.map((l) => [l.id, l.priority]));

      // 只考虑未软删的仓（listLocations 已过滤），仓级优先级用于排序
      const snapshots: LevelSnapshot[] = levels
        .filter((l) => priorityByLocation.has(l.stock_location_id))
        .map((l) => ({
          inventoryItemId: l.inventory_item_id,
          stockLocationId: l.stock_location_id,
          priority: priorityByLocation.get(l.stock_location_id)!,
          availableQuantity: l.available_quantity,
        }));

      const plan = planAllocation(snapshots, input.items, itemByVariant);
      if (!plan.ok) throw insufficientStock(plan.variantId, plan.requested, plan.available);

      const levelIdByKey = new Map(
        levels.map((l) => [`${l.inventory_item_id}:${l.stock_location_id}`, l.id]),
      );

      const reservationIds: string[] = [];
      for (const allocation of plan.allocations) {
        const itemId = itemByVariant.get(allocation.variantId)!;
        const levelId = levelIdByKey.get(`${itemId}:${allocation.stockLocationId}`);
        if (!levelId) throw levelNotFound(itemId, allocation.stockLocationId);

        if (!(await repo.tryReserveLevel(levelId, allocation.quantity))) {
          const fresh = await repo.findLevel(itemId, allocation.stockLocationId);
          throw insufficientStock(
            allocation.variantId,
            allocation.quantity,
            fresh?.available_quantity ?? 0,
          );
        }
        const reservation = await repo.createReservation({
          inventoryItemId: itemId,
          stockLocationId: allocation.stockLocationId,
          lineItemId: `${input.orderId}:${allocation.variantId}:${allocation.stockLocationId}`,
          orderId: input.orderId,
          quantity: allocation.quantity,
          workflowRunId: input.workflowRunId ?? null,
        });
        reservationIds.push(reservation.id);
      }

      return { reservationIds, allocations: plan.allocations };
    });
  }

  /** 按指定仓预留（后台/运维/测试用）；内部同样走原子条件 UPDATE。 */
  async reserve(input: ReserveInput): Promise<ReservationDTO> {
    assertQuantity(input.variantId, input.quantity);
    return this.repo.withTransaction(async (repo) => {
      const itemByVariant = await repo.itemIdsByVariantIds([input.variantId]);
      const itemId = itemByVariant.get(input.variantId);
      if (!itemId) throw inventoryItemNotFound(input.variantId);

      const level = await repo.findLevel(itemId, input.locationId);
      if (!level) throw levelNotFound(itemId, input.locationId);
      if (!(await repo.tryReserveLevel(level.id, input.quantity))) {
        const fresh = await repo.findLevel(itemId, input.locationId);
        throw insufficientStock(input.variantId, input.quantity, fresh?.available_quantity ?? 0);
      }

      return repo.createReservation({
        inventoryItemId: itemId,
        stockLocationId: input.locationId,
        lineItemId: input.lineItemId,
        orderId: input.orderId ?? null,
        quantity: input.quantity,
        workflowRunId: input.workflowRunId ?? null,
      });
    });
  }

  async releaseReservation(reservationId: string): Promise<void> {
    await this.repo.withTransaction(async (repo) => {
      const rsv = await repo.findReservation(reservationId);
      if (!rsv) throw reservationNotFound(reservationId);
      if (rsv.status !== "reserved") throw reservationStateInvalid(reservationId, rsv.status);

      const level = await repo.findLevel(rsv.inventory_item_id, rsv.stock_location_id);
      if (!level) throw levelNotFound(rsv.inventory_item_id, rsv.stock_location_id);
      await repo.releaseLevelQuantity(level.id, rsv.quantity);
      await repo.setReservationStatus(reservationId, "released");
    });
  }

  async commitReservation(reservationId: string): Promise<void> {
    await this.repo.withTransaction(async (repo) => {
      const rsv = await repo.findReservation(reservationId);
      if (!rsv) throw reservationNotFound(reservationId);
      if (rsv.status !== "reserved") throw reservationStateInvalid(reservationId, rsv.status);

      const level = await repo.findLevel(rsv.inventory_item_id, rsv.stock_location_id);
      if (!level) throw levelNotFound(rsv.inventory_item_id, rsv.stock_location_id);
      await repo.commitLevelQuantity(level.id, rsv.quantity);
      await repo.setReservationStatus(reservationId, "committed");
    });
  }

  async adjustLevel(input: {
    inventoryItemId: string;
    locationId: string;
    delta: number;
    reason: string;
  }): Promise<InventoryLevelDTO> {
    if (!Number.isInteger(input.delta)) throw invalidQuantity(input.inventoryItemId, input.delta);
    const level = await this.repo.findLevel(input.inventoryItemId, input.locationId);
    if (!level) throw levelNotFound(input.inventoryItemId, input.locationId);
    await this.repo.adjustLevelQuantity(level.id, input.delta);
    return (await this.repo.findLevel(input.inventoryItemId, input.locationId))!;
  }

  async adjustLevelByLevelId(
    levelId: string,
    input: { delta: number; reason: string },
  ): Promise<InventoryLevelDTO> {
    if (!Number.isInteger(input.delta)) throw invalidQuantity(levelId, input.delta);
    const level = await this.repo.findLevelById(levelId);
    if (!level) throw levelNotFound(levelId, "");
    await this.repo.adjustLevelQuantity(level.id, input.delta);
    return (await this.repo.findLevelById(levelId))!;
  }
}

/** 数量必须是正整数（库存计数禁浮点/零/负）。 */
function assertQuantity(variantId: string, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) throw invalidQuantity(variantId, quantity);
}

/**
 * 幂等回放时从已有预留还原 allocation 视图。
 * 优先用「变体 → 库存项」映射；历史/异常数据回落到 line_item_id（orderId:variantId:locationId）。
 */
function allocationsFromReservations(
  reservations: ReservationDTO[],
  itemByVariant: Map<string, string>,
  orderId: string,
): AllocationSpec[] {
  const variantByItem = new Map<string, string>();
  for (const [variantId, itemId] of itemByVariant) variantByItem.set(itemId, variantId);

  return reservations.map((r) => ({
    variantId:
      variantByItem.get(r.inventory_item_id) ?? variantFromLineItemId(r.line_item_id, orderId),
    stockLocationId: r.stock_location_id,
    quantity: r.quantity,
  }));
}

function variantFromLineItemId(lineItemId: string, orderId: string): string {
  const prefix = `${orderId}:`;
  if (lineItemId.startsWith(prefix)) {
    const rest = lineItemId.slice(prefix.length);
    const sep = rest.lastIndexOf(":");
    if (sep > 0) return rest.slice(0, sep);
  }
  return lineItemId;
}
