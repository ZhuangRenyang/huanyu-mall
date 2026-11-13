import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 到货提醒（ADR-059）：顾客在售罄商品上登记，补货时发邮件。
 *
 * 唯一键 (variant_id, email)：重复点「到货提醒」是常态，不是错误 ——
 * 用唯一索引收敛，服务层靠 onConflictDoNothing 拿回已有记录。
 */
export const stockAlert = pgTable(
  "stock_alert",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").notNull(),
    email: text("email").notNull(),
    /** 登录顾客 id；游客为空（不建跨模块外键）。 */
    customerId: text("customer_id"),
    /** 已发通知的时间；null = 待通知。 */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_stock_alert_variant_email").on(t.variantId, t.email),
    index("idx_stock_alert_pending").on(t.variantId),
  ],
);
