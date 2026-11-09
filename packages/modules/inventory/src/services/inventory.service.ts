import {
  insufficientStock,
  inventoryItemNotFound,
  levelNotFound,
  reservationNotFound,
  reservationStateInvalid,
} from "../errors.js";
import type {
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
 */
export class InventoryService implements IInventoryModuleService {
  constructor(private readonly repo: InventoryRepository) {}

  async listInventoryItems(q: { limit: number; offset: number }): Promise<{
    items: import("../types.js").InventoryItemDTO[];
    count: number;
  }> {
    return this.repo.listItems(q);
  }

  /** 可用仓库列表（按 priority 降序）；一期单仓时取第一个即默认仓。 */
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

  async reserve(input: ReserveInput): Promise<ReservationDTO> {
    const itemByVariant = await this.repo.itemIdsByVariantIds([input.variantId]);
    const itemId = itemByVariant.get(input.variantId);
    if (!itemId) throw inventoryItemNotFound(input.variantId);

    const level = await this.repo.findLevel(itemId, input.locationId);
    if (!level) throw levelNotFound(itemId, input.locationId);
    if (level.available_quantity < input.quantity) {
      throw insufficientStock(input.variantId, input.quantity, level.available_quantity);
    }

    // 先建预留（独立记账），再更新库存量
    const reservation = await this.repo.createReservation({
      inventoryItemId: itemId,
      stockLocationId: input.locationId,
      lineItemId: input.lineItemId,
      orderId: input.orderId ?? null,
      quantity: input.quantity,
      workflowRunId: input.workflowRunId ?? null,
    });
    const reserved = level.reserved_quantity + input.quantity;
    await this.repo.updateLevel(level.id, {
      stockedQuantity: level.stocked_quantity,
      reservedQuantity: reserved,
      availableQuantity: level.stocked_quantity - reserved,
    });
    return reservation;
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const rsv = await this.repo.findReservation(reservationId);
    if (!rsv) throw reservationNotFound(reservationId);
    if (rsv.status !== "reserved") throw reservationStateInvalid(reservationId, rsv.status);

    const level = await this.repo.findLevel(rsv.inventory_item_id, rsv.stock_location_id);
    if (!level) throw levelNotFound(rsv.inventory_item_id, rsv.stock_location_id);
    const reserved = Math.max(0, level.reserved_quantity - rsv.quantity);
    await this.repo.updateLevel(level.id, {
      stockedQuantity: level.stocked_quantity,
      reservedQuantity: reserved,
      availableQuantity: level.stocked_quantity - reserved,
    });
    await this.repo.setReservationStatus(reservationId, "released");
  }

  async commitReservation(reservationId: string): Promise<void> {
    const rsv = await this.repo.findReservation(reservationId);
    if (!rsv) throw reservationNotFound(reservationId);
    if (rsv.status !== "reserved") throw reservationStateInvalid(reservationId, rsv.status);

    const level = await this.repo.findLevel(rsv.inventory_item_id, rsv.stock_location_id);
    if (!level) throw levelNotFound(rsv.inventory_item_id, rsv.stock_location_id);
    const stocked = level.stocked_quantity - rsv.quantity;
    const reserved = Math.max(0, level.reserved_quantity - rsv.quantity);
    await this.repo.updateLevel(level.id, {
      stockedQuantity: stocked,
      reservedQuantity: reserved,
      availableQuantity: stocked - reserved,
    });
    await this.repo.setReservationStatus(reservationId, "committed");
  }

  async adjustLevel(input: {
    inventoryItemId: string;
    locationId: string;
    delta: number;
    reason: string;
  }): Promise<InventoryLevelDTO> {
    const level = await this.repo.findLevel(input.inventoryItemId, input.locationId);
    if (!level) throw levelNotFound(input.inventoryItemId, input.locationId);
    const stocked = level.stocked_quantity + input.delta;
    await this.repo.updateLevel(level.id, {
      stockedQuantity: stocked,
      reservedQuantity: level.reserved_quantity,
      availableQuantity: stocked - level.reserved_quantity,
    });
    const updated = await this.repo.findLevel(input.inventoryItemId, input.locationId);
    return updated!;
  }

  async adjustLevelByLevelId(
    levelId: string,
    input: { delta: number; reason: string },
  ): Promise<InventoryLevelDTO> {
    const level = await this.repo.findLevelById(levelId);
    if (!level) throw levelNotFound(levelId, "");
    const stocked = level.stocked_quantity + input.delta;
    await this.repo.updateLevel(level.id, {
      stockedQuantity: stocked,
      reservedQuantity: level.reserved_quantity,
      availableQuantity: stocked - level.reserved_quantity,
    });
    return (await this.repo.findLevelById(levelId))!;
  }
}
