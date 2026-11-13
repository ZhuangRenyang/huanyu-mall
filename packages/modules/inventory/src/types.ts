/** M07 Inventory DTO 与契约（对齐架构 §2.1）。 */

export type ReservationStatus = "reserved" | "committed" | "released";

export type InventoryTransferStatus = "pending" | "completed" | "cancelled";

export interface AvailabilityDTO {
  variantId: string;
  available: number;
}

export interface ReservationDTO {
  id: string;
  inventory_item_id: string;
  /** 从 inventory_item_variant 反查出来的变体（用于把预留映射到订单行）。 */
  variant_id: string | null;
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

/**
 * 低库存预警默认阈值（ADR-074）。
 *
 * 卖手机和卖家具的「低库存」不是一个数（ADR-039 让库存页传自己的阈值），
 * 但工作台卡片总得有个默认口径 —— 5 件，与库存页输入框默认值一致。
 * 将来做成店铺设置时，只改这一个来源。
 */
export const LOW_STOCK_ALERT_THRESHOLD = 5;

/** 后台「仓 × SKU」库存行（带 sku，供仓储/调拨页展示）。 */
export interface InventoryLevelRowDTO extends InventoryLevelDTO {
  sku: string;
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

/** 仓间调拨流水（ADR-013 §4）：只搬运 stocked，不动 reserved。 */
export interface InventoryTransferDTO {
  id: string;
  inventory_item_id: string;
  /** 物料 SKU（列表 join 出来，便于后台直接展示；单查时可能为 null）。 */
  sku: string | null;
  from_location_id: string;
  to_location_id: string;
  quantity: number;
  status: InventoryTransferStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
  findInventoryItem(id: string): Promise<InventoryItemDTO | null>;
  findLevelsByItemIds(itemIds: string[]): Promise<InventoryLevelDTO[]>;
  /** 库存项 → 变体 id（补货事件要按变体通知到货提醒）。 */
  variantIdsByItemId(inventoryItemId: string): Promise<string[]>;
  /** 按仓列「仓 × SKU」库存行（sku 来自 inventory_item）；locationId 为空则全仓。 */
  listLevels(q: {
    locationId?: string;
    /** 只返回可用量 ≤ 该值的行（库存预警，ADR-039）。 */
    lowStockThreshold?: number;
    limit: number;
    offset: number;
  }): Promise<{ items: InventoryLevelRowDTO[]; count: number }>;
  /** 低库存规格数（ADR-074）：按 inventory_item 去重，多仓不重复计数。 */
  countLowStockItems(threshold: number): Promise<number>;
  /** 列出可用仓库（按 priority 降序）。 */
  listLocations(): Promise<StockLocationDTO[]>;
  findLocation(id: string): Promise<StockLocationDTO | null>;
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
  adjustLevelQuantity(levelId: string, delta: number): Promise<boolean>;
  /**
   * 仓间搬货（ADR-013 §4）：源仓条件扣减（不能动已承诺给订单的货），
   * 目标仓 upsert。必须在调用方事务内执行，返回源仓是否扣减成功。
   */
  moveStock(input: {
    inventoryItemId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
  }): Promise<boolean>;
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
  updateStockLocation(id: string, patch: { name?: string; priority?: number }): Promise<StockLocationDTO>;
  createLevel(input: {
    inventoryItemId: string;
    stockLocationId: string;
    stockedQuantity: number;
  }): Promise<InventoryLevelDTO>;
  linkVariant(itemId: string, variantId: string): Promise<void>;
  // —— 仓间调拨流水 ——
  createTransfer(input: {
    inventoryItemId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    note?: string | null;
    createdBy?: string | null;
  }): Promise<InventoryTransferDTO>;
  findTransfer(id: string): Promise<InventoryTransferDTO | null>;
  listTransfers(q: {
    limit: number;
    offset: number;
    status?: InventoryTransferStatus;
  }): Promise<{ items: InventoryTransferDTO[]; count: number }>;
  /** 条件状态流转（CAS）：仅当当前状态为 from 时改为 to，返回是否生效（并发双完成兜底）。 */
  transitionTransferStatus(
    id: string,
    from: InventoryTransferStatus,
    to: InventoryTransferStatus,
  ): Promise<boolean>;
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
  createStockLocation(input: { name: string; priority?: number }): Promise<StockLocationDTO>;
  updateStockLocation(id: string, patch: { name?: string; priority?: number }): Promise<StockLocationDTO>;
  /** 按订单查未释放的预留 id（workflow 幂等兜底/发货关联用）。 */
  listReservationIdsByOrder(orderId: string): Promise<string[]>;
  /** 按订单查未释放的预留明细（发货按仓拆单用，含 stock_location_id/quantity）。 */
  listReservationsByOrder(orderId: string): Promise<ReservationDTO[]>;
  listInventoryItems(q: { limit: number; offset: number }): Promise<{ items: InventoryItemDTO[]; count: number }>;
  /** 按仓列库存行（后台库存页/调拨页）。 */
  listInventoryLevels(q: {
    locationId?: string;
    /** 只返回可用量 ≤ 该值的行（库存预警）。 */
    lowStockThreshold?: number;
    limit: number;
    offset: number;
  }): Promise<{ items: InventoryLevelRowDTO[]; count: number }>;
  /**
   * 低库存规格数（工作台「库存预警」卡，ADR-074）。
   *
   * 按 inventory_item 去重：多仓时同一规格有几行库存，但商家要补的是**一个规格**，
   * 数行数会虚高（2 个仓各 3 件 = 报 2 个预警，实际只有 1 个 SKU 要补）。
   */
  countLowStockItems(threshold: number): Promise<number>;
  /**
   * 整单原子分配 + 预留：按仓 priority 贪心，可跨仓拆单；同一 orderId 幂等。
   * 任一 SKU 合计不足 → 整单失败，不产生部分预留。
   */
  allocateAndReserve(input: AllocateAndReserveInput): Promise<AllocateAndReserveResult>;
  /** 按指定仓预留（后台/运维/测试用）；内部走原子条件 UPDATE。 */
  reserve(input: ReserveInput): Promise<ReservationDTO>;
  releaseReservation(reservationId: string): Promise<void>;
  /**
   * 幂等释放（ADR-075）：已释放 / 已提交 / 不存在都直接返回。
   *
   * 取消订单要释放这张单的全部预留，而工作流重试时前一批可能已经放过了 ——
   * 用 releaseReservation 会在第一条已释放的预留上抛错，整次重试永远失败。
   */
  releaseReservationIfReserved(reservationId: string): Promise<void>;
  /** 某订单的预留（取消订单时按单释放库存）。 */
  listReservationsByOrder(orderId: string): Promise<ReservationDTO[]>;
  commitReservation(reservationId: string): Promise<void>;
  adjustLevel(input: {
    inventoryItemId: string;
    locationId: string;
    delta: number;
    reason: string;
  }): Promise<InventoryLevelDTO>;
  adjustLevelByLevelId(levelId: string, input: { delta: number; reason: string }): Promise<InventoryLevelDTO>;
  // —— 仓间调拨（pending 只登记不占量；completed 才搬货）——
  createInventoryTransfer(input: {
    inventoryItemId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    note?: string | null;
    createdBy?: string | null;
  }): Promise<InventoryTransferDTO>;
  completeInventoryTransfer(id: string): Promise<InventoryTransferDTO>;
  cancelInventoryTransfer(id: string): Promise<InventoryTransferDTO>;
  listInventoryTransfers(q: {
    limit: number;
    offset: number;
    status?: InventoryTransferStatus;
  }): Promise<{ items: InventoryTransferDTO[]; count: number }>;
}
