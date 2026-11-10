import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  InventoryItemDTO,
  InventoryLevelDTO,
  InventoryRepository,
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
  async reservationIdsByOrder(orderId: string): Promise<string[]> {
    // reservation_item 无软删列，软删以 status 表达（reserved → committed/released）
    const res = await this.db.execute(
      sql`SELECT id FROM reservation_item
          WHERE order_id = ${orderId} AND status = 'reserved'`,
    );
    return (res.rows as Array<Record<string, unknown>>).map((r) => String(r.id));
  }

  /** 按订单查未释放的预留明细（幂等回放：已有预留直接返回，不重复扣减）。 */
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
    return rows.map(toReservationDTO);
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

  /** 原子调整在库量（相对增量），available 由 stocked - reserved 现算。 */
  async adjustLevelQuantity(levelId: string, delta: number): Promise<void> {
    await this.db.execute(
      sql`UPDATE inventory_level
             SET stocked_quantity = stocked_quantity + ${delta},
                 available_quantity = (stocked_quantity + ${delta}) - reserved_quantity,
                 updated_at = now()
           WHERE id = ${levelId} AND deleted_at IS NULL`,
    );
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

function toReservationDTO(r: typeof schema.reservationItem.$inferSelect): ReservationDTO {
  return {
    id: r.id,
    inventory_item_id: r.inventoryItemId,
    stock_location_id: r.stockLocationId,
    line_item_id: r.lineItemId,
    order_id: r.orderId ?? null,
    quantity: r.quantity,
    status: r.status as ReservationStatus,
    workflow_run_id: r.workflowRunId ?? null,
  };
}
