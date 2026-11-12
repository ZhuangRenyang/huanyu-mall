import { bigint, boolean, char, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const shippingProfile = pgTable("shipping_profile", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const shippingZone = pgTable("shipping_zone", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 所属运费模板；NULL 视同默认模板（历史数据）。 */
  profileId: text("profile_id"),
  countryCodes: jsonb("country_codes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const shippingOption = pgTable(
  "shipping_option",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    zoneId: text("zone_id").notNull().references(() => shippingZone.id),
    carrier: text("carrier"),
    type: text("type").notNull().default("flat"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_shipopt_zone").on(t.zoneId)],
);

export const shippingOptionPriceRule = pgTable(
  "shipping_option_price_rule",
  {
    id: text("id").primaryKey(),
    shippingOptionId: text("shipping_option_id").notNull().references(() => shippingOption.id),
    ruleType: text("rule_type").notNull(),
    weightMinG: integer("weight_min_g"),
    weightMaxG: integer("weight_max_g"),
    orderOverMinor: bigint("order_over_minor", { mode: "bigint" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_shiprule_option").on(t.shippingOptionId)],
);

export const fulfillment = pgTable(
  "fulfillment",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    /** 所属仓（ADR-013 §3）；历史数据为 null。跨模块不加外键。 */
    stockLocationId: text("stock_location_id"),
    status: text("status").notNull().default("not_fulfilled"),
    trackingLinks: jsonb("tracking_links"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_fulf_order").on(t.orderId)],
);

export const fulfillmentItem = pgTable(
  "fulfillment_item",
  {
    id: text("id").primaryKey(),
    fulfillmentId: text("fulfillment_id").notNull().references(() => fulfillment.id),
    orderLineItemId: text("order_line_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_fulfitem_fulfillment").on(t.fulfillmentId)],
);

export const shipment = pgTable(
  "shipment",
  {
    id: text("id").primaryKey(),
    fulfillmentId: text("fulfillment_id").notNull().references(() => fulfillment.id),
    carrierName: text("carrier_name").notNull(),
    trackingNumber: text("tracking_number").notNull(),
    shippedAt: timestamp("shipped_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_ship_fulfillment").on(t.fulfillmentId)],
);
