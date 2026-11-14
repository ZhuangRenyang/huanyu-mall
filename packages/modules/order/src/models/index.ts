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
/** 订单发票申请单（ADR-098）：手工登记版，一张订单一张。 */
export const orderInvoice = pgTable(
  "order_invoice",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    customerId: text("customer_id"),
    /** personal = 个人；company = 企业（需税号）。 */
    type: text("type").notNull().default("personal"),
    title: text("title").notNull(),
    taxId: text("tax_id"),
    email: text("email").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    remark: text("remark"),
    /** pending = 待开票；issued = 已开票；rejected = 已拒绝。 */
    status: text("status").notNull().default("pending"),
    invoiceNo: text("invoice_no"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_order_invoice_order").on(t.orderId),
    index("idx_order_invoice_status").on(t.status),
  ],
);

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
    /** 售后类型：仅退款 / 退货退款（ADR-051）。 */
    resolution: text("resolution").notNull().default("refund_only"),
    /** 同意退货时快照的退货地址（ADR-061）；null = 当时未配置。 */
    returnAddress: text("return_address"),
    /** 买家退货物流（退货退款 / 换货寄回）。 */
    returnCarrier: text("return_carrier"),
    returnTrackingNumber: text("return_tracking_number"),
    returnShippedAt: timestamp("return_shipped_at", { withTimezone: true }),
    returnReceivedAt: timestamp("return_received_at", { withTimezone: true }),
    /** 换货目标规格 id（ADR-090）。 */
    exchangeVariantId: text("exchange_variant_id"),
    /** 换货数量（ADR-090）。 */
    exchangeQuantity: integer("exchange_quantity"),
    /** 换货目标快照文案（商品名/规格，ADR-090）。 */
    exchangeLabel: text("exchange_label"),
    /** 商家换出物流（ADR-090）。 */
    exchangeCarrier: text("exchange_carrier"),
    exchangeTrackingNumber: text("exchange_tracking_number"),
    exchangeShippedAt: timestamp("exchange_shipped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_refund_req_order").on(t.orderId), index("idx_refund_req_status").on(t.status)],
);
