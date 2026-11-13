import { prefixedUlid } from "@mall/core";
import { notificationConfigInvalid, notificationNotFound } from "../errors.js";
import { renderOrderConfirmation, renderShipmentNotification, renderStockAlert } from "./templates.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import { sendViaSmtp, type SmtpConfig } from "./smtp-transport.js";
import type {
  EmailMessage,
  INotificationModuleService,
  NotificationDTO,
  NotificationRepository,
  NotificationRow,
  NotificationSettingsDTO,
  NotificationSettingsRecord,
  NotificationStatus,
  OrderConfirmationPayload,
  ShipmentNotificationPayload,
  StockAlertPayload,
  UpdateNotificationSettingsInput,
} from "../types.js";

/** 失败自动重试上限：超过就只留人工重发，不让错误配置刷日志（ADR-016 §5）。 */
const MAX_AUTO_ATTEMPTS = 3;

/**
 * 发信实现：默认走 SMTP；测试注入替身即可断言「发了几封、内容是什么」，
 * 不需要真的连邮件服务器。
 */
export type SmtpSender = (cfg: SmtpConfig, msg: EmailMessage) => Promise<void>;

export class NotificationService implements INotificationModuleService {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly sender: SmtpSender = sendViaSmtp,
  ) {}

  // —— 设置 ——

  async getSettings(): Promise<NotificationSettingsDTO> {
    const record = await this.repo.getSettings();
    return settingsDTO(record ?? DEFAULT_SETTINGS);
  }

  async updateSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettingsDTO> {
    validate(input);
    const patch: Partial<NotificationSettingsDTO> & { smtp_password_enc?: string | null } = {};
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.from_name !== undefined) patch.from_name = input.from_name;
    if (input.from_email !== undefined) patch.from_email = input.from_email;
    if (input.smtp_host !== undefined) patch.smtp_host = input.smtp_host;
    if (input.smtp_port !== undefined) patch.smtp_port = input.smtp_port;
    if (input.smtp_secure !== undefined) patch.smtp_secure = input.smtp_secure;
    if (input.smtp_user !== undefined) patch.smtp_user = input.smtp_user;
    if (input.order_confirmation_enabled !== undefined) {
      patch.order_confirmation_enabled = input.order_confirmation_enabled;
    }
    if (input.shipment_enabled !== undefined) patch.shipment_enabled = input.shipment_enabled;
    if (input.stock_alert_enabled !== undefined) {
      patch.stock_alert_enabled = input.stock_alert_enabled;
    }
    if (input.storefront_url !== undefined) patch.storefront_url = input.storefront_url;
    if (input.smtp_password !== undefined) {
      patch.smtp_password_enc =
        input.smtp_password === "" ? null : encryptSecret(input.smtp_password);
    }
    return settingsDTO(await this.repo.upsertSettings(patch));
  }

  /**
   * 到货提醒（ADR-059）：补货时由订阅者调用。
   *
   * 去重键带 `createdAt`：顾客通知过一次后可以重新登记（重新登记会刷新创建时间），
   * 下一次补货能再收到一封；而同一次登记被重复派发时键相同，insertIfAbsent 会挡住。
   */
  async enqueueStockAlert(payload: StockAlertPayload): Promise<void> {
    const settings = await this.repo.getSettings();
    if (!settings?.enabled || !settings.stock_alert_enabled) return;
    const rendered = renderStockAlert(payload, {
      fromName: settings.from_name || settings.from_email,
      storefrontUrl: settings.storefront_url,
    });
    await this.repo.insertIfAbsent({
      id: prefixedUlid("ntf"),
      template: "stock_alert",
      to_email: payload.email,
      subject: rendered.subject,
      body_html: rendered.html,
      body_text: rendered.text,
      status: "pending",
      attempts: 0,
      error: null,
      // 到货提醒不属于某笔订单（顾客还没下单），order_id 留空
      order_id: null,
      dedupe_key: `stock:${payload.alertId}:${payload.createdAt}`,
    });
  }

  // —— 入队（事件订阅者只调这里，毫秒级）——

  async enqueueOrderConfirmation(payload: OrderConfirmationPayload): Promise<void> {
    const settings = await this.repo.getSettings();
    if (!settings?.enabled || !settings.order_confirmation_enabled) return;
    const rendered = renderOrderConfirmation(payload, {
      fromName: settings.from_name || settings.from_email,
      storefrontUrl: settings.storefront_url,
    });
    await this.repo.insertIfAbsent({
      id: prefixedUlid("ntf"),
      template: "order_confirmation",
      to_email: payload.email,
      subject: rendered.subject,
      body_html: rendered.html,
      body_text: rendered.text,
      status: "pending",
      attempts: 0,
      error: null,
      order_id: payload.orderId,
      dedupe_key: `order:${payload.orderId}:confirmation`,
    });
  }

  async enqueueShipmentNotification(
    fulfillmentId: string,
    payload: ShipmentNotificationPayload,
  ): Promise<void> {
    const settings = await this.repo.getSettings();
    if (!settings?.enabled || !settings.shipment_enabled) return;
    const rendered = renderShipmentNotification(payload, {
      fromName: settings.from_name || settings.from_email,
      storefrontUrl: settings.storefront_url,
    });
    await this.repo.insertIfAbsent({
      id: prefixedUlid("ntf"),
      template: "shipment_notification",
      to_email: payload.email,
      subject: rendered.subject,
      body_html: rendered.html,
      body_text: rendered.text,
      status: "pending",
      attempts: 0,
      error: null,
      order_id: payload.orderId,
      // 按发货单去重：拆单两仓 = 两封信，这是正确行为
      dedupe_key: `fulfillment:${fulfillmentId}:shipment`,
    });
  }

  // —— 管理动作 ——

  async sendTest(to: string): Promise<void> {
    const settings = await this.repo.getSettings();
    if (!settings) throw notificationConfigInvalid("尚未保存过通知配置");
    await this.sender(smtpConfig(settings), {
      to,
      subject: "【测试】商城邮件通知已就绪",
      html:
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:16px;font-size:14px;line-height:22px;color:#111">' +
        "如果你收到这封邮件，说明 SMTP 配置正确，下单确认与发货通知可以正常发送。</td></tr></table>",
      text: "如果你收到这封邮件，说明 SMTP 配置正确，下单确认与发货通知可以正常发送。",
    });
  }

  /** 通用发信：验证码等一次性邮件，不落库（短命内容，留档只是噪声）。 */
  async sendMail(input: EmailMessage): Promise<void> {
    const settings = await this.repo.getSettings();
    if (!settings) throw notificationConfigInvalid("尚未保存过通知配置");
    await this.sender(smtpConfig(settings), input);
  }

  async list(q: {
    limit: number;
    offset: number;
    status?: NotificationStatus;
  }): Promise<{ items: NotificationDTO[]; count: number }> {
    const res = await this.repo.list(q);
    return { items: res.items.map(rowDTO), count: res.count };
  }

  async resend(id: string): Promise<NotificationDTO> {
    const row = await this.repo.resetForResend(id);
    if (!row) throw notificationNotFound(id);
    // 手动重发不进自动重试队列：失败就停在 failed，让操作员看到原因自己决定
    await this.deliverRow(row, { autoRetry: false });
    const after = await this.repo.findById(id);
    return rowDTO(after ?? row);
  }

  // —— 派发器调用 ——

  async claimPending(limit: number): Promise<NotificationRow[]> {
    return this.repo.claimBatch(limit);
  }

  async deliverRow(row: NotificationRow, opts: { autoRetry?: boolean } = {}): Promise<void> {
    const settings = await this.repo.getSettings();
    if (!settings) {
      await this.repo.markFailed(row.id, "通知配置缺失", null);
      return;
    }
    try {
      await this.sender(smtpConfig(settings), {
        to: row.to_email,
        subject: row.subject,
        html: row.body_html,
        text: row.body_text,
      });
      await this.repo.markSent(row.id);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const autoRetry = opts.autoRetry !== false;
      const delay =
        autoRetry && row.attempts < MAX_AUTO_ATTEMPTS ? Math.max(30, row.attempts * 60) : null;
      await this.repo.markFailed(row.id, message, delay);
    }
  }
}

const DEFAULT_SETTINGS: NotificationSettingsRecord = {
  enabled: false,
  from_name: "",
  from_email: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: "",
  smtp_password_set: false,
  smtp_password_enc: null,
  order_confirmation_enabled: true,
  shipment_enabled: true,
  stock_alert_enabled: true,
  storefront_url: "",
};

function settingsDTO(r: NotificationSettingsRecord): NotificationSettingsDTO {
  return {
    enabled: r.enabled,
    from_name: r.from_name,
    from_email: r.from_email,
    smtp_host: r.smtp_host,
    smtp_port: r.smtp_port,
    smtp_secure: r.smtp_secure,
    smtp_user: r.smtp_user,
    smtp_password_set: r.smtp_password_enc != null && r.smtp_password_enc.length > 0,
    order_confirmation_enabled: r.order_confirmation_enabled,
    shipment_enabled: r.shipment_enabled,
    stock_alert_enabled: r.stock_alert_enabled,
    storefront_url: r.storefront_url,
  };
}

function rowDTO(r: NotificationRow): NotificationDTO {
  return {
    id: r.id,
    template: r.template,
    to_email: r.to_email,
    subject: r.subject,
    status: r.status,
    attempts: r.attempts,
    error: r.error,
    order_id: r.order_id,
    created_at: r.created_at.toISOString(),
    sent_at: r.sent_at ? r.sent_at.toISOString() : null,
  };
}

function smtpConfig(r: NotificationSettingsRecord): SmtpConfig {
  return {
    host: r.smtp_host,
    port: r.smtp_port,
    secure: r.smtp_secure,
    user: r.smtp_user,
    password: r.smtp_password_enc ? decryptSecret(r.smtp_password_enc) : "",
    fromName: r.from_name,
    fromEmail: r.from_email,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(input: UpdateNotificationSettingsInput): void {
  if (input.smtp_port !== undefined) {
    if (!Number.isInteger(input.smtp_port) || input.smtp_port < 1 || input.smtp_port > 65535) {
      throw notificationConfigInvalid("SMTP 端口必须是 1–65535 的整数");
    }
  }
  if (input.from_email !== undefined && input.from_email !== "" && !EMAIL_RE.test(input.from_email)) {
    throw notificationConfigInvalid("发件人邮箱格式不正确");
  }
  if (input.storefront_url !== undefined && input.storefront_url !== "") {
    if (!/^https?:\/\//i.test(input.storefront_url)) {
      throw notificationConfigInvalid("店铺地址必须以 http:// 或 https:// 开头");
    }
  }
}
