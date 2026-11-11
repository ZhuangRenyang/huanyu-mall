import { bigint, char, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
    /** 收货国家（ISO 两位大写）：税与运费的唯一口径来源（ADR-019）。 */
    shippingCountry: char("shipping_country", { length: 2 }),
    /** 顾客输入的 voucher codes（string[]），持久化，刷新不丢；金额由 promotion 侧读时算。 */
    voucherCodes: jsonb("voucher_codes"),
    /** 顾客输入的 gift card codes（string[]），持久化，刷新不丢；抵扣金额由 promotion 侧读时算。 */
    giftCardCodes: jsonb("gift_card_codes"),
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
