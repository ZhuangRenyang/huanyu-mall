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

export type AllocationSpec = {
  variantId: string;
  stockLocationId: string;
  quantity: number;
};

export interface InventoryRepository {
  /** inventory_item_variant link：变体 → inventory_item id（批量禁循环）。 */
  itemIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>>;
  listItems(q: { limit: number; offset: number }): Promise<{ items: InventoryItemDTO[]; count: number }>;
  findLevelsByItemIds(itemIds: string[]): Promise<InventoryLevelDTO[]>;
  /** 列出可用仓库（按 priority 降序）。 */
  listLocations(): Promise<StockLocationDTO[]>;
  /** 按订单查未释放的预留 id。 */
  reservationIdsByOrder(orderId: string): Promise<string[]>;
  /** 按订单查未释放的预留明细（幂等回放用）。 */
  findReservationsByOrder(orderId: string): Promise<ReservationDTO[]>;
  findLevel(itemId: string, locationId: string): Promise<InventoryLevelDTO | null>;
  findLevelById(levelId: string): Promise<InventoryLevelDTO | null>;
  /**
   * 原子占用：仅当 available_quantity >= quantity 时 reserved += qty、available -= qty。
   * 条件写进同一条 UPDATE（消除 check-then-act 竞态），返回是否抢到。
   */
  tryReserveLevel(levelId: string, quantity: number): Promise<boolean>;
  /** 原子释放：reserved -= qty（下限 0），available = stocked - reserved。 */
  releaseLevelQuantity(levelId: string, quantity: number): Promise<void>;
  /** 原子出库：stocked -= qty、reserved -= qty（下限 0），available = stocked - reserved。 */
  commitLevelQuantity(levelId: string, quantity: number): Promise<void>;
  /** 原子调整在库量：stocked += delta，available = stocked - reserved。 */
  adjustLevelQuantity(levelId: string, delta: number): Promise<void>;
  /** 同一事务内执行 fn；fn 收到的 repo 绑定事务连接。 */
  withTransaction<T>(fn: (repo: InventoryRepository) => Promise<T>): Promise<T>;
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

export interface AllocateAndReserveInput {
  orderId: string;
  items: Array<{ variantId: string; quantity: number }>;
  workflowRunId?: string;
}

export interface AllocateAndReserveResult {
  reservationIds: string[];
  allocations: AllocationSpec[];
}

export interface IInventoryModuleService {
  getAvailability(input: { variantIds: string[]; locationIds?: string[] }): Promise<AvailabilityDTO[]>;
  /** 可用仓库列表（按 priority 降序）；一期单仓时取第一个即默认仓。 */
  listStockLocations(): Promise<StockLocationDTO[]>;
  /** 按订单查未释放的预留 id（发货转出库用）。 */
  listReservationsByOrder(orderId: string): Promise<string[]>;
  listInventoryItems(q: { limit: number; offset: number }): Promise<{ items: InventoryItemDTO[]; count: number }>;
  /**
   * 整单原子分配 + 预留：按仓 priority 贪心，可跨仓拆单；同一 orderId 幂等。
   * 任一 SKU 合计不足 → 整单失败，不产生部分预留。
   */
  allocateAndReserve(input: AllocateAndReserveInput): Promise<AllocateAndReserveResult>;
  /** 按指定仓预留（后台/运维/测试用）；内部走原子条件 UPDATE。 */
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
