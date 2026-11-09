/** M07 Inventory DTO 与契约（对齐架构 §2.1）。 */

export type ReservationStatus = "reserved" | "committed" | "released";

export interface AvailabilityDTO {
  variantId: string;
  available: number;
}

export interface ReservationDTO {
  id: string;
  inventory_item_id: string;
  stock_location_id: string;
  line_item_id: string;
  order_id: string | null;
  quantity: number;
  status: ReservationStatus;
  workflow_run_id: string | null;
}

export interface InventoryLevelDTO {
  id: string;
  inventory_item_id: string;
  stock_location_id: string;
  stocked_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
}

export interface InventoryItemDTO {
  id: string;
  sku: string;
  title: string | null;
  requires_shipping: boolean;
}

export interface StockLocationDTO {
  id: string;
  name: string;
  priority: number;
}

export interface ReserveInput {
  variantId: string;
  locationId: string;
  quantity: number;
  lineItemId: string;
  workflowRunId?: string;
  orderId?: string;
}

export interface InventoryRepository {
  /** inventory_item_variant link：变体 → inventory_item id（批量禁循环）。 */
  itemIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>>;
  listItems(q: { limit: number; offset: number }): Promise<{ items: InventoryItemDTO[]; count: number }>;
  findLevelsByItemIds(itemIds: string[]): Promise<InventoryLevelDTO[]>;
  /** 列出可用仓库（按 priority 降序）。 */
  listLocations(): Promise<StockLocationDTO[]>;
  /** 按订单查未释放的预留 id。 */
  reservationIdsByOrder(orderId: string): Promise<string[]>;
  findLevel(itemId: string, locationId: string): Promise<InventoryLevelDTO | null>;
  findLevelById(levelId: string): Promise<InventoryLevelDTO | null>;
  updateLevel(
    levelId: string,
    patch: { stockedQuantity: number; reservedQuantity: number; availableQuantity: number },
  ): Promise<void>;
  createReservation(input: {
    inventoryItemId: string;
    stockLocationId: string;
    lineItemId: string;
    orderId?: string | null;
    quantity: number;
    workflowRunId?: string | null;
  }): Promise<ReservationDTO>;
  findReservation(id: string): Promise<ReservationDTO | null>;
  setReservationStatus(id: string, status: ReservationStatus): Promise<void>;
  /** 测试/种子：建库存项 + 仓库 + 库存量 + 变体关联。 */
  createInventoryItem(input: { sku: string; title?: string | null }): Promise<InventoryItemDTO>;
  createStockLocation(input: { name: string; priority?: number }): Promise<StockLocationDTO>;
  createLevel(input: {
    inventoryItemId: string;
    stockLocationId: string;
    stockedQuantity: number;
  }): Promise<InventoryLevelDTO>;
  linkVariant(itemId: string, variantId: string): Promise<void>;
}

export interface IInventoryModuleService {
  getAvailability(input: { variantIds: string[]; locationIds?: string[] }): Promise<AvailabilityDTO[]>;
  /** 可用仓库列表（按 priority 降序）；一期单仓时取第一个即默认仓。 */
  listStockLocations(): Promise<StockLocationDTO[]>;
  /** 按订单查未释放的预留 id（发货转出库用）。 */
  listReservationsByOrder(orderId: string): Promise<string[]>;
  listInventoryItems(q: { limit: number; offset: number }): Promise<{ items: InventoryItemDTO[]; count: number }>;
  reserve(input: ReserveInput): Promise<ReservationDTO>;
  releaseReservation(reservationId: string): Promise<void>;
  commitReservation(reservationId: string): Promise<void>;
  adjustLevel(input: {
    inventoryItemId: string;
    locationId: string;
    delta: number;
    reason: string;
  }): Promise<InventoryLevelDTO>;
  adjustLevelByLevelId(levelId: string, input: { delta: number; reason: string }): Promise<InventoryLevelDTO>;
}
