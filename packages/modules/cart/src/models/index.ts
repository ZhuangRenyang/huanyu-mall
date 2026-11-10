import { bigint, boolean, char, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const cart = pgTable(
  "cart",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    regionId: text("region_id").notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    customerId: text("customer_id"),
    email: text("email"),
    status: text("status").notNull().default("open"),
    totals: jsonb("totals"),
    metadata: jsonb("metadata"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_cart_channel").on(t.channelId),
    index("idx_cart_customer").on(t.customerId).where(sql`${t.customerId} IS NOT NULL`),
  ],
);

export const cartLineItem = pgTable(
  "cart_line_item",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id").notNull().references(() => cart.id),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_cli_cart").on(t.cartId)],
);

export const cartLineItemAdjustment = pgTable(
  "cart_line_item_adjustment",
  {
    id: text("id").primaryKey(),
    cartLineItemId: text("cart_line_item_id").notNull().references(() => cartLineItem.id),
    type: text("type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    description: text("description"),
    // 目录促销行级折扣（阶段 2 扩展，见 ADR-012 §3）
    promotionId: text("promotion_id"),
    code: text("code"),
    isTaxInclusive: boolean("is_tax_inclusive").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_clia_line").on(t.cartLineItemId)],
);

export const cartShippingMethod = pgTable(
  "cart_shipping_method",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id").notNull().references(() => cart.id),
    shippingOptionId: text("shipping_option_id").notNull(),
    name: text("name").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_csm_cart").on(t.cartId)],
);
