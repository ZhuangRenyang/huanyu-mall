import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** 通知配置单例行（ADR-016：默认全关，密码加密存储）。 */
export const notificationSettings = pgTable("notification_settings", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  fromName: text("from_name").notNull().default(""),
  fromEmail: text("from_email").notNull().default(""),
  smtpHost: text("smtp_host").notNull().default(""),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: text("smtp_user").notNull().default(""),
  smtpPasswordEnc: text("smtp_password_enc"),
  orderConfirmationEnabled: boolean("order_confirmation_enabled").notNull().default(true),
  shipmentEnabled: boolean("shipment_enabled").notNull().default(true),
  /** 到货提醒邮件开关（ADR-059）。 */
  stockAlertEnabled: boolean("stock_alert_enabled").notNull().default(true),
  storefrontUrl: text("storefront_url").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 发信 outbox：先落库后发送，崩溃不丢、失败可重试。 */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    template: text("template").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    orderId: text("order_id"),
    dedupeKey: text("dedupe_key").notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notification_dedupe_key_uq").on(t.dedupeKey),
    index("notification_status_created_idx").on(t.status, t.createdAt),
    index("notification_order_idx").on(t.orderId),
  ],
);
