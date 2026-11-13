import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  InventoryItemDTO,
  InventoryLevelDTO,
  InventoryLevelRowDTO,
  InventoryRepository,
  InventoryTransferDTO,
  InventoryTransferStatus,
  ReservationDTO,
  ReservationStatus,
  StockLocationDTO,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleInventoryRepository implements InventoryRepository {
  constructor(private readonly db: Db) {}

  async itemIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (variantIds.length === 0) return map;
    const inClause = sql.join(variantIds.map((id) => sql`${id}`), sql`, `);
    const res = await this.db.execute(
      sql`SELECT variant_id, inventory_item_id FROM inventory_item_variant WHERE variant_id IN (${inClause}) AND deleted_at IS NULL`,
    );
    for (const row of res.rows as Array<Record<string, unknown>>) {
      map.set(String(row.variant_id), String(row.inventory_item_id));
    }
    return map;
  }

  async variantIdsByItemId(inventoryItemId: string): Promise<string[]> {
    const res = await this.db.execute(
      sql`SELECT variant_id FROM inventory_item_variant WHERE inventory_item_id = ${inventoryItemId} AND deleted_at IS NULL`,
    );
    return (res.rows as Array<Record<string, unknown>>).map((r) => String(r.variant_id));
  }

  async findLevelsByItemIds(itemIds: string[]): Promise<InventoryLevelDTO[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.inventoryLevel)
      .where(
        and(inArray(schema.inventoryLevel.inventoryItemId, itemIds), isNull(schema.inventoryLevel.deletedAt)),
      );
    return rows.map(toLevelDTO);
  }

  async listItems(q: { limit: number; offset: number }): Promise<{ items: InventoryItemDTO[]; count: number }> {
    const rows = await this.db
      .select()
      .from(schema.inventoryItem)
      .where(isNull(schema.inventoryItem.deletedAt))
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.inventoryItem)
      .where(isNull(schema.inventoryItem.deletedAt));
    return {
      items: rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        title: r.title ?? null,
        requires_shipping: r.requiresShipping,
      })),
      count: countRows[0]?.count ?? 0,
    };
  }

  /** 按订单查未释放的预留 id（发货时转真实出库）。 */
  async reservationIdsByOrder(orderId: string): Promise<string[]> {    // reservation_item 无软删列，软删以 status 表达（reserved → committed/released）
    const res = await this.db.execute(
      sql`SELECT id FROM reservation_item
          WHERE order_id = ${orderId} AND status = 'reserved'`,
    );
    return (res.rows as Array<Record<string, unknown>>).map((r) => String(r.id));
  }

  /** 按订单查未释放的预留明细（幂等回放 + 发货计划：附带 variant_id 以映射订单行）。 */
  async findReservationsByOrder(orderId: string): Promise<ReservationDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.reservationItem)
      .where(
        and(
          eq(schema.reservationItem.orderId, orderId),
          eq(schema.reservationItem.status, "reserved"),
        ),
      );
    if (rows.length === 0) return [];
    const itemIds = [...new Set(rows.map((r) => r.inventoryItemId))];
    const variantByItem = await this.variantIdsByItemIds(itemIds);
    return rows.map((r) => toReservationDTO(r, variantByItem.get(r.inventoryItemId) ?? null));
  }

  /** inventory_item_id → variant_id（同一物料挂多个变体时取字典序最小，保证确定性）。 */
  private async variantIdsByItemIds(itemIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (itemIds.length === 0) return map;
    const inClause = sql.join(itemIds.map((id) => sql`${id}`), sql`, `);
    const res = await this.db.execute(
      sql`SELECT inventory_item_id, variant_id FROM inventory_item_variant
          WHERE inventory_item_id IN (${inClause}) AND deleted_at IS NULL
          ORDER BY variant_id ASC`,
    );
    for (const row of res.rows as Array<Record<string, unknown>>) {
      const itemId = String(row.inventory_item_id);
      if (!map.has(itemId)) map.set(itemId, String(row.variant_id));
    }
    return map;
  }

  /** 列出可用仓库（按 priority 降序；一期单仓时取第一个即默认仓）。 */
  async listLocations(): Promise<StockLocationDTO[]> {
    const res = await this.db.execute(
      sql`SELECT id, name, priority FROM stock_location
          WHERE deleted_at IS NULL
          ORDER BY priority DESC, created_at ASC`,
    );
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      priority: Number(r.priority ?? 0),
    }));
  }

  async findInventoryItem(id: string): Promise<InventoryItemDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.inventoryItem)
      .where(and(eq(schema.inventoryItem.id, id), isNull(schema.inventoryItem.deletedAt)))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, sku: r.sku, title: r.title ?? null, requires_shipping: r.requiresShipping };
  }

  /** 按仓列「仓 × SKU」库存行（sku 冗余带出，后台库存/调拨页直接展示）。 */
  async listLevels(q: {
    locationId?: string;
    lowStockThreshold?: number;
    limit: number;
    offset: number;
  }): Promise<{ items: InventoryLevelRowDTO[]; count: number }> {
    const conditions = and(
      isNull(schema.inventoryLevel.deletedAt),
      isNull(schema.inventoryItem.deletedAt),
      q.locationId ? eq(schema.inventoryLevel.stockLocationId, q.locationId) : undefined,
      // 库存预警：可用量 ≤ 阈值。用 available 而不是 stocked ——
      // 已预留的货卖不了，按在库量预警会漏掉「看起来有货但已经卖光」的 SKU
      q.lowStockThreshold !== undefined
        ? lte(schema.inventoryLevel.availableQuantity, q.lowStockThreshold)
        : undefined,
    );
    const rows = await this.db
      .select({
        id: schema.inventoryLevel.id,
        inventoryItemId: schema.inventoryLevel.inventoryItemId,
        sku: schema.inventoryItem.sku,
        stockLocationId: schema.inventoryLevel.stockLocationId,
        stockedQuantity: schema.inventoryLevel.stockedQuantity,
        reservedQuantity: schema.inventoryLevel.reservedQuantity,
        availableQuantity: schema.inventoryLevel.availableQuantity,
      })
      .from(schema.inventoryLevel)
      .innerJoin(
        schema.inventoryItem,
        eq(schema.inventoryLevel.inventoryItemId, schema.inventoryItem.id),
      )
      .where(conditions)
      .orderBy(asc(schema.inventoryLevel.stockLocationId), asc(schema.inventoryItem.sku))
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.inventoryLevel)
      .innerJoin(
        schema.inventoryItem,
        eq(schema.inventoryLevel.inventoryItemId, schema.inventoryItem.id),
      )
      .where(conditions);
    return {
      items: rows.map((r) => ({
        id: r.id,
        inventory_item_id: r.inventoryItemId,
        sku: r.sku,
        stock_location_id: r.stockLocationId,
        stocked_quantity: r.stockedQuantity,
        reserved_quantity: r.reservedQuantity,
        available_quantity: r.availableQuantity,
      })),
      count: countRows[0]?.count ?? 0,
    };
  }

  async findLocation(id: string): Promise<StockLocationDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.stockLocation)
      .where(and(eq(schema.stockLocation.id, id), isNull(schema.stockLocation.deletedAt)))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, name: r.name, priority: r.priority };
  }

  async findLevelById(levelId: string): Promise<InventoryLevelDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.inventoryLevel)
      .where(and(eq(schema.inventoryLevel.id, levelId), isNull(schema.inventoryLevel.deletedAt)))
      .limit(1);
    return rows[0] ? toLevelDTO(rows[0]) : null;
  }

  async findLevel(itemId: string, locationId: string): Promise<InventoryLevelDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.inventoryLevel)
      .where(
        and(
          eq(schema.inventoryLevel.inventoryItemId, itemId),
          eq(schema.inventoryLevel.stockLocationId, locationId),
          isNull(schema.inventoryLevel.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toLevelDTO(rows[0]) : null;
  }

  /**
   * 原子占用：条件与增量在同一条 UPDATE 里，杜绝「先读 available 再写绝对值」的丢更新。
   * 返回 false 表示可用量不足（或行不存在/已软删），调用方据此拒绝整单。
   */
  async tryReserveLevel(levelId: string, quantity: number): Promise<boolean> {
    const res = await this.db.execute(
      sql`UPDATE inventory_level
             SET reserved_quantity = reserved_quantity + ${quantity},
                 available_quantity = available_quantity - ${quantity},
                 updated_at = now()
           WHERE id = ${levelId}
             AND available_quantity >= ${quantity}
             AND deleted_at IS NULL
         RETURNING id`,
    );
    return res.rows.length > 0;
  }

  /** 原子释放：reserved 减到 0 为下限，available 由 stocked - reserved 现算。 */
  async releaseLevelQuantity(levelId: string, quantity: number): Promise<void> {
    await this.db.execute(
      sql`UPDATE inventory_level
             SET reserved_quantity = GREATEST(0, reserved_quantity - ${quantity}),
                 available_quantity = stocked_quantity - GREATEST(0, reserved_quantity - ${quantity}),
                 updated_at = now()
           WHERE id = ${levelId} AND deleted_at IS NULL`,
    );
  }

  /** 原子出库：stocked/reserved 同减，available 由新值现算。 */
  async commitLevelQuantity(levelId: string, quantity: number): Promise<void> {
    await this.db.execute(
      sql`UPDATE inventory_level
             SET stocked_quantity = stocked_quantity - ${quantity},
                 reserved_quantity = GREATEST(0, reserved_quantity - ${quantity}),
                 available_quantity = (stocked_quantity - ${quantity}) - GREATEST(0, reserved_quantity - ${quantity}),
                 updated_at = now()
           WHERE id = ${levelId} AND deleted_at IS NULL`,
    );
  }

  /**
   * 原子调整在库量（相对增量），available 由 stocked - reserved 现算。
   * 条件 `stocked + delta >= reserved`：调减不得吃掉已承诺给订单的货。
   * 返回 false 表示会低于预留量（调用方拒绝）。
   */
  async adjustLevelQuantity(levelId: string, delta: number): Promise<boolean> {
    const res = await this.db.execute(
      sql`UPDATE inventory_level
             SET stocked_quantity = stocked_quantity + ${delta},
                 available_quantity = (stocked_quantity + ${delta}) - reserved_quantity,
                 updated_at = now()
           WHERE id = ${levelId}
             AND deleted_at IS NULL
             AND stocked_quantity + ${delta} >= reserved_quantity
         RETURNING id`,
    );
    return res.rows.length > 0;
  }

  /**
   * 仓间搬货（ADR-013 §4）：源仓一条条件 UPDATE 完成「校验 + 扣减」，
   * 杜绝先读再写绝对值。目标仓不存在则在同一事务内新建。
   * 调用方必须已开启事务（service 用 withTransaction 包裹）。
   */
  async moveStock(input: {
    inventoryItemId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
  }): Promise<boolean> {
    const moved = await this.db.execute(
      sql`UPDATE inventory_level
             SET stocked_quantity = stocked_quantity - ${input.quantity},
                 available_quantity = available_quantity - ${input.quantity},
                 updated_at = now()
           WHERE inventory_item_id = ${input.inventoryItemId}
             AND stock_location_id = ${input.fromLocationId}
             AND stocked_quantity - reserved_quantity >= ${input.quantity}
             AND deleted_at IS NULL
         RETURNING id`,
    );
    if (moved.rows.length === 0) return false;

    const added = await this.db.execute(
      sql`UPDATE inventory_level
             SET stocked_quantity = stocked_quantity + ${input.quantity},
                 available_quantity = available_quantity + ${input.quantity},
                 updated_at = now()
           WHERE inventory_item_id = ${input.inventoryItemId}
             AND stock_location_id = ${input.toLocationId}
             AND deleted_at IS NULL
         RETURNING id`,
    );
    if (added.rows.length === 0) {
      await this.db
        .insert(schema.inventoryLevel)
        .values({
          id: prefixedUlid("invlvl"),
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.toLocationId,
          stockedQuantity: input.quantity,
          reservedQuantity: 0,
          availableQuantity: input.quantity,
        });
    }
    return true;
  }

  /** 同一事务内执行：分配计算、条件占用、写预留要么全成、要么全回滚。 */
  async withTransaction<T>(fn: (repo: InventoryRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) =>
      fn(new DrizzleInventoryRepository(tx as unknown as Db)),
    );
  }

  async createReservation(input: {
    inventoryItemId: string;
    stockLocationId: string;
    lineItemId: string;
    orderId?: string | null;
    quantity: number;
    workflowRunId?: string | null;
  }): Promise<ReservationDTO> {
    const rows = await this.db
      .insert(schema.reservationItem)
      .values({
        id: prefixedUlid("rsv"),
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
        lineItemId: input.lineItemId,
        orderId: input.orderId ?? null,
        quantity: input.quantity,
        status: "reserved",
        workflowRunId: input.workflowRunId ?? null,
      })
      .returning();
    return toReservationDTO(rows[0]!);
  }

  async findReservation(id: string): Promise<ReservationDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.reservationItem)
      .where(eq(schema.reservationItem.id, id))
      .limit(1);
    return rows[0] ? toReservationDTO(rows[0]) : null;
  }

  async setReservationStatus(id: string, status: ReservationStatus): Promise<void> {
    await this.db
      .update(schema.reservationItem)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.reservationItem.id, id));
  }

  async createInventoryItem(input: { sku: string; title?: string | null }): Promise<InventoryItemDTO> {
    const rows = await this.db
      .insert(schema.inventoryItem)
      .values({ id: prefixedUlid("invitem"), sku: input.sku, title: input.title ?? null })
      .returning();
    const r = rows[0]!;
    return { id: r.id, sku: r.sku, title: r.title ?? null, requires_shipping: r.requiresShipping };
  }

  async createStockLocation(input: { name: string; priority?: number }): Promise<StockLocationDTO> {
    const rows = await this.db
      .insert(schema.stockLocation)
      .values({ id: prefixedUlid("loc"), name: input.name, priority: input.priority ?? 0 })
      .returning();
    const r = rows[0]!;
    return { id: r.id, name: r.name, priority: r.priority };
  }

  async updateStockLocation(
    id: string,
    patch: { name?: string; priority?: number },
  ): Promise<StockLocationDTO> {
    const values: { name?: string; priority?: number; updatedAt: Date } = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.priority !== undefined) values.priority = patch.priority;
    const rows = await this.db
      .update(schema.stockLocation)
      .set(values)
      .where(and(eq(schema.stockLocation.id, id), isNull(schema.stockLocation.deletedAt)))
      .returning();
    const r = rows[0];
    if (!r) throw new Error(`Stock location not found: ${id}`);
    return { id: r.id, name: r.name, priority: r.priority };
  }

  async createLevel(input: {
    inventoryItemId: string;
    stockLocationId: string;
    stockedQuantity: number;
  }): Promise<InventoryLevelDTO> {
    const rows = await this.db
      .insert(schema.inventoryLevel)
      .values({
        id: prefixedUlid("invlvl"),
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
        stockedQuantity: input.stockedQuantity,
        reservedQuantity: 0,
        availableQuantity: input.stockedQuantity,
      })
      .returning();
    return toLevelDTO(rows[0]!);
  }

  async linkVariant(itemId: string, variantId: string): Promise<void> {
    await this.db.execute(
      sql`INSERT INTO inventory_item_variant (id, inventory_item_id, variant_id) VALUES (${prefixedUlid("lnk")}, ${itemId}, ${variantId})`,
    );
  }

  // —— 仓间调拨流水 ——

  async createTransfer(input: {
    inventoryItemId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    note?: string | null;
    createdBy?: string | null;
  }): Promise<InventoryTransferDTO> {
    const rows = await this.db
      .insert(schema.inventoryTransfer)
      .values({
        id: prefixedUlid("xfer"),
        inventoryItemId: input.inventoryItemId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        quantity: input.quantity,
        status: "pending",
        note: input.note ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return toTransferDTO(rows[0]!);
  }

  async findTransfer(id: string): Promise<InventoryTransferDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.inventoryTransfer)
      .where(eq(schema.inventoryTransfer.id, id))
      .limit(1);
    return rows[0] ? toTransferDTO(rows[0]) : null;
  }

  async listTransfers(q: {
    limit: number;
    offset: number;
    status?: InventoryTransferStatus;
  }): Promise<{ items: InventoryTransferDTO[]; count: number }> {
    const condition = q.status
      ? eq(schema.inventoryTransfer.status, q.status)
      : sql`true`;
    const rows = await this.db
      .select({ transfer: schema.inventoryTransfer, sku: schema.inventoryItem.sku })
      .from(schema.inventoryTransfer)
      .leftJoin(
        schema.inventoryItem,
        eq(schema.inventoryItem.id, schema.inventoryTransfer.inventoryItemId),
      )
      .where(condition)
      .orderBy(sql`${schema.inventoryTransfer.createdAt} DESC`)
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.inventoryTransfer)
      .where(condition);
    return {
      items: rows.map((r) => toTransferDTO(r.transfer, r.sku ?? null)),
      count: countRows[0]?.count ?? 0,
    };
  }

  /**
   * 条件状态流转（CAS）：并发下两个 complete 只有一个能把 pending 改成 completed，
   * 另一个影响 0 行 → 抛状态错误并回滚自己那笔搬货。
   */
  async transitionTransferStatus(
    id: string,
    from: InventoryTransferStatus,
    to: InventoryTransferStatus,
  ): Promise<boolean> {
    const res = await this.db.execute(
      sql`UPDATE inventory_transfer
             SET status = ${to}, updated_at = now()
           WHERE id = ${id} AND status = ${from}
         RETURNING id`,
    );
    return res.rows.length > 0;
  }
}

function toTransferDTO(
  r: typeof schema.inventoryTransfer.$inferSelect,
  sku: string | null = null,
): InventoryTransferDTO {
  return {
    id: r.id,
    inventory_item_id: r.inventoryItemId,
    sku,
    from_location_id: r.fromLocationId,
    to_location_id: r.toLocationId,
    quantity: r.quantity,
    status: r.status as InventoryTransferStatus,
    note: r.note ?? null,
    created_by: r.createdBy ?? null,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function toLevelDTO(r: typeof schema.inventoryLevel.$inferSelect): InventoryLevelDTO {
  return {
    id: r.id,
    inventory_item_id: r.inventoryItemId,
    stock_location_id: r.stockLocationId,
    stocked_quantity: r.stockedQuantity,
    reserved_quantity: r.reservedQuantity,
    available_quantity: r.availableQuantity,
  };
}

function toReservationDTO(
  r: typeof schema.reservationItem.$inferSelect,
  variantId: string | null = null,
): ReservationDTO {
  return {
    id: r.id,
    inventory_item_id: r.inventoryItemId,
    variant_id: variantId,
    stock_location_id: r.stockLocationId,
    line_item_id: r.lineItemId,
    order_id: r.orderId ?? null,
    quantity: r.quantity,
    status: r.status as ReservationStatus,
    workflow_run_id: r.workflowRunId ?? null,
  };
}
