import { and, desc, eq, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  NotificationRepository,
  NotificationRow,
  NotificationSettingsDTO,
  NotificationSettingsRecord,
  NotificationStatus,
  NotificationTemplate,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Db) {}

  async getSettings(): Promise<NotificationSettingsRecord | null> {
    const rows = await this.db.select().from(schema.notificationSettings).limit(1);
    return rows[0] ? toSettingsDTO(rows[0]) : null;
  }

  async upsertSettings(
    patch: Partial<NotificationSettingsDTO> & { smtp_password_enc?: string | null },
  ): Promise<NotificationSettingsRecord> {
    const current = await this.getSettings();
    const values = {
      id: "notification_default",
      enabled: patch.enabled ?? current?.enabled ?? false,
      fromName: patch.from_name ?? current?.from_name ?? "",
      fromEmail: patch.from_email ?? current?.from_email ?? "",
      smtpHost: patch.smtp_host ?? current?.smtp_host ?? "",
      smtpPort: patch.smtp_port ?? current?.smtp_port ?? 587,
      smtpSecure: patch.smtp_secure ?? current?.smtp_secure ?? false,
      smtpUser: patch.smtp_user ?? current?.smtp_user ?? "",
      // 不在 patch 里出现 = 保持原样；显式 null = 清除
      smtpPasswordEnc:
        patch.smtp_password_enc === undefined
          ? (current?.smtp_password_enc ?? null)
          : patch.smtp_password_enc,
      orderConfirmationEnabled: patch.order_confirmation_enabled ?? current?.order_confirmation_enabled ?? true,
      shipmentEnabled: patch.shipment_enabled ?? current?.shipment_enabled ?? true,
      // 与上面同一口径：不在 patch 里出现 = 保持原样（漏这一行，开关会静默被忽略）
      stockAlertEnabled: patch.stock_alert_enabled ?? current?.stock_alert_enabled ?? true,
      refundEnabled: patch.refund_enabled ?? current?.refund_enabled ?? true,
      storefrontUrl: patch.storefront_url ?? current?.storefront_url ?? "",
      updatedAt: new Date(),
    };
    const rows = await this.db
      .insert(schema.notificationSettings)
      .values(values)
      .onConflictDoUpdate({ target: schema.notificationSettings.id, set: values })
      .returning();
    return toSettingsDTO(rows[0]!);
  }

  async insertIfAbsent(
    row: Omit<NotificationRow, "created_at" | "sent_at" | "next_attempt_at">,
  ): Promise<NotificationRow | null> {
    const rows = await this.db
      .insert(schema.notification)
      .values({
        id: row.id,
        template: row.template,
        toEmail: row.to_email,
        subject: row.subject,
        bodyHtml: row.body_html,
        bodyText: row.body_text,
        status: row.status,
        attempts: row.attempts,
        error: row.error,
        orderId: row.order_id,
        dedupeKey: row.dedupe_key,
      })
      .onConflictDoNothing({ target: schema.notification.dedupeKey })
      .returning();
    return rows[0] ? toRow(rows[0]) : null;
  }

  async claimBatch(limit: number): Promise<NotificationRow[]> {
    // 一条语句原子领取：SKIP LOCKED 保证多进程不重复发同一条
    const res = await this.db.execute(sql`
      UPDATE notification
         SET status = 'sending',
             attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM notification
          WHERE attempts < 3
            AND (
              -- 待发：没排期就是「立即可发」
              (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
              -- 失败：必须被排了期才重试。next_attempt_at IS NULL 表示「放弃」，
              -- 不能当成可发——否则手动重发失败的信会被派发器无限次偷偷重发。
              OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now())
            )
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
   RETURNING *`);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      template: String(r.template) as NotificationTemplate,
      to_email: String(r.to_email),
      subject: String(r.subject),
      body_html: String(r.body_html),
      body_text: String(r.body_text),
      status: String(r.status) as NotificationStatus,
      attempts: Number(r.attempts),
      error: r.error == null ? null : String(r.error),
      order_id: r.order_id == null ? null : String(r.order_id),
      dedupe_key: String(r.dedupe_key),
      next_attempt_at: r.next_attempt_at == null ? null : new Date(String(r.next_attempt_at)),
      created_at: new Date(String(r.created_at)),
      sent_at: r.sent_at == null ? null : new Date(String(r.sent_at)),
    }));
  }

  async markSent(id: string): Promise<void> {
    await this.db
      .update(schema.notification)
      .set({ status: "sent", sentAt: new Date(), error: null, nextAttemptAt: null })
      .where(eq(schema.notification.id, id));
  }

  async markFailed(id: string, error: string, retryDelaySeconds: number | null): Promise<void> {
    await this.db
      .update(schema.notification)
      .set({
        status: "failed",
        error,
        nextAttemptAt:
          retryDelaySeconds === null ? null : new Date(Date.now() + retryDelaySeconds * 1000),
      })
      .where(eq(schema.notification.id, id));
  }

  async resetForResend(id: string): Promise<NotificationRow | null> {
    const rows = await this.db
      .update(schema.notification)
      // 直接置 sending：手动重发期间不让派发器再领一次，避免同一条发两封
      .set({ status: "sending", attempts: 1, error: null, nextAttemptAt: null, sentAt: null })
      .where(eq(schema.notification.id, id))
      .returning();
    return rows[0] ? toRow(rows[0]) : null;
  }

  async findById(id: string): Promise<NotificationRow | null> {
    const rows = await this.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, id))
      .limit(1);
    return rows[0] ? toRow(rows[0]) : null;
  }

  async list(q: {
    limit: number;
    offset: number;
    status?: NotificationStatus;
  }): Promise<{ items: NotificationRow[]; count: number }> {
    const condition = q.status ? eq(schema.notification.status, q.status) : undefined;
    const rows = await this.db
      .select()
      .from(schema.notification)
      .where(condition)
      .orderBy(desc(schema.notification.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.notification)
      .where(condition);
    return {
      items: rows.map(toRow),
      count: countRows[0]?.count ?? 0,
    };
  }
}

function toSettingsDTO(
  r: typeof schema.notificationSettings.$inferSelect,
): NotificationSettingsRecord {
  return {
    enabled: r.enabled,
    from_name: r.fromName,
    from_email: r.fromEmail,
    smtp_host: r.smtpHost,
    smtp_port: r.smtpPort,
    smtp_secure: r.smtpSecure,
    smtp_user: r.smtpUser,
    smtp_password_set: r.smtpPasswordEnc != null && r.smtpPasswordEnc.length > 0,
    smtp_password_enc: r.smtpPasswordEnc,
    order_confirmation_enabled: r.orderConfirmationEnabled,
    shipment_enabled: r.shipmentEnabled,
    stock_alert_enabled: r.stockAlertEnabled,
    refund_enabled: r.refundEnabled,
    storefront_url: r.storefrontUrl,
  };
}

function toRow(r: typeof schema.notification.$inferSelect): NotificationRow {
  return {
    id: r.id,
    template: r.template as NotificationTemplate,
    to_email: r.toEmail,
    subject: r.subject,
    body_html: r.bodyHtml,
    body_text: r.bodyText,
    status: r.status as NotificationStatus,
    attempts: r.attempts,
    error: r.error,
    order_id: r.orderId,
    dedupe_key: r.dedupeKey,
    next_attempt_at: r.nextAttemptAt,
    created_at: r.createdAt,
    sent_at: r.sentAt,
  };
}
