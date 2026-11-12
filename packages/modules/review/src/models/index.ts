import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * 商品评价（ADR-042）。实际 DDL 以手写迁移 migrations/0001_init.sql 为唯一事实。
 *
 * - 金额无关，不涉及 minor unit；
 * - product_title / customer_name 是建单时的快照（跨模块无外键）；
 * - 软删统一 deleted_at。
 */
export const productReview = pgTable(
  "product_review",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    productTitle: text("product_title").notNull(),
    orderId: text("order_id").notNull(),
    customerId: text("customer_id").notNull(),
    /** 展示名（已脱敏，如「张**」）；后台看到的也是它，真实身份从订单查。 */
    customerName: text("customer_name").notNull(),
    rating: integer("rating").notNull(),
    content: text("content").notNull().default(""),
    isVisible: boolean("is_visible").notNull().default(true),
    /** 商家解释（淘宝的「解释」）。 */
    reply: text("reply"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("ck_product_review_rating", sql`${t.rating} BETWEEN 1 AND 5`),
    uniqueIndex("uq_product_review_order_product")
      .on(t.orderId, t.productId, t.customerId)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_product_review_product")
      .on(t.productId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL AND ${t.isVisible}`),
    index("idx_product_review_admin").on(t.createdAt),
  ],
);
