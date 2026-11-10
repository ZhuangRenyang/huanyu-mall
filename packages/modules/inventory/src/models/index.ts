import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** M07 Inventory 4 表。K1：保留 stock_location 维度 + reservation 独立记账。 */

export const inventoryItem = pgTable(
  "inventory_item",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    title: text("title"),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_inventory_item_sku").on(t.sku).where(sql`${t.deletedAt} IS NULL`)],
);

export const stockLocation = pgTable("stock_location", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: jsonb("address"),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const inventoryLevel = pgTable(
  "inventory_level",
  {
    id: text("id").primaryKey(),
    inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItem.id),
    stockLocationId: text("stock_location_id").notNull().references(() => stockLocation.id),
    stockedQuantity: integer("stocked_quantity").notNull().default(0),
    reservedQuantity: integer("reserved_quantity").notNull().default(0),
    availableQuantity: integer("available_quantity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_inventory_level")
      .on(t.inventoryItemId, t.stockLocationId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const reservationItem = pgTable(
  "reservation_item",
  {
    id: text("id").primaryKey(),
    inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItem.id),
    stockLocationId: text("stock_location_id").notNull().references(() => stockLocation.id),
    lineItemId: text("line_item_id").notNull(),
    orderId: text("order_id"),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("reserved"),
    workflowRunId: text("workflow_run_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_rsv_item").on(t.inventoryItemId, t.stockLocationId),
    index("idx_rsv_status").on(t.status),
  ],
);

/** 仓间调拨流水（ADR-013 §4）：只搬运 stocked，不动 reserved。 */
export const inventoryTransfer = pgTable(
  "inventory_transfer",
  {
    id: text("id").primaryKey(),
    fromLocationId: text("from_location_id").notNull().references(() => stockLocation.id),
    toLocationId: text("to_location_id").notNull().references(() => stockLocation.id),
    inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItem.id),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("pending"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_transfer_from").on(t.fromLocationId),
    index("idx_transfer_to").on(t.toLocationId),
    index("idx_transfer_item").on(t.inventoryItemId),
  ],
);
