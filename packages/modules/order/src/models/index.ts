import { bigint, char, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const order = pgTable(
  "order",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("pending"),
    cartId: text("cart_id"),
    customerId: text("customer_id"),
    email: text("email").notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    channelId: text("channel_id").notNull(),
    regionId: text("region_id").notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
    shippingMinor: bigint("shipping_minor", { mode: "bigint" }).notNull().default(0n),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull().default(0n),
    discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(0n),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    shippingAddress: jsonb("shipping_address").notNull(),
    billingAddress: jsonb("billing_address"),
    paymentCollectionId: text("payment_collection_id"),
    /** 商家内部备注（仅后台可见）。 */
    merchantNote: text("merchant_note"),
    /** 顾客下单留言（顾客与商家均可见，淘宝「给卖家留言」）。 */
    customerNote: text("customer_note"),
    metadata: jsonb("metadata"),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_order_status").on(t.status), index("idx_order_channel").on(t.channelId)],
);

export const orderLineItem = pgTable(
  "order_line_item",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => order.id),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    title: text("title").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxAmountMinor: bigint("tax_amount_minor", { mode: "bigint" }).notNull().default(0n),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    options: jsonb("options"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_oli_order").on(t.orderId)],
);

export const orderItemSnapshot = pgTable(
  "order_item_snapshot",
  {
    id: text("id").primaryKey(),
    orderLineItemId: text("order_line_item_id").notNull().references(() => orderLineItem.id),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_ois_line").on(t.orderLineItemId)],
);

export const orderShippingMethod = pgTable(
  "order_shipping_method",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => order.id),
    name: text("name").notNull(),
    carrierName: text("carrier_name"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_osm_order").on(t.orderId)],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => order.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_osh_order").on(t.orderId)],
);

/** 订单折扣留痕（order_discount，阶段 3 新增）：不可变，记录「哪个促销给了多少钱」（资金安全硬约束 5）。 */
export const orderDiscount = pgTable(
  "order_discount",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => order.id),
    promotionId: text("promotion_id").notNull(),
    code: text("code"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    type: text("type").notNull(), // 'catalogue' | 'order' | 'voucher' | 'gift_card'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_order_discount_order").on(t.orderId)],
);

/** 退款申请单（售后业务单据，与 payment.refund 资金流水分开）。 */
export const refundRequest = pgTable(
  "refund_request",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    customerId: text("customer_id"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    reason: text("reason").notNull(),
    /** customer = 买家申请；merchant = 商家主动退款。 */
    source: text("source").notNull().default("customer"),
    status: text("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** 资金流水 id（payment.refund.id）。 */
    refundId: text("refund_id"),
    /** 申请时的订单状态，拒绝/撤销时据此恢复。 */
    orderStatusBefore: text("order_status_before"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_refund_req_order").on(t.orderId), index("idx_refund_req_status").on(t.status)],
);
