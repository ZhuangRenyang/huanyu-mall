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

  async updateLevel(
    levelId: string,
    patch: { stockedQuantity: number; reservedQuantity: number; availableQuantity: number },
  ): Promise<void> {
    await this.db
      .update(schema.inventoryLevel)
      .set({
        stockedQuantity: patch.stockedQuantity,
        reservedQuantity: patch.reservedQuantity,
        availableQuantity: patch.availableQuantity,
        updatedAt: new Date(),
      })
      .where(eq(schema.inventoryLevel.id, levelId));
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
