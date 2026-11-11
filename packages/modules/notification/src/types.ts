/** M-notification 契约（ADR-016）。邮件是交易类通知，不是营销工具。 */

export type NotificationTemplate = "order_confirmation" | "shipment_notification";
export type NotificationStatus = "pending" | "sending" | "sent" | "failed";

export interface NotificationSettingsDTO {
  enabled: boolean;
  from_name: string;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  /** 只读：SMTP 密码是否已配置。密码本身永不出接口。 */
  smtp_password_set: boolean;
  order_confirmation_enabled: boolean;
  shipment_enabled: boolean;
  storefront_url: string;
}

export interface UpdateNotificationSettingsInput {
  enabled?: boolean;
  from_name?: string;
  from_email?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  /** 不传 = 保持不变；空字符串 = 清除。 */
  smtp_password?: string;
  order_confirmation_enabled?: boolean;
  shipment_enabled?: boolean;
  storefront_url?: string;
}

export interface NotificationDTO {
  id: string;
  template: NotificationTemplate;
  to_email: string;
  subject: string;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  order_id: string | null;
  created_at: string;
  sent_at: string | null;
}

/** 下单确认邮件的数据（由 workflows 从订单装配，本模块只负责渲染与投递）。 */
export interface OrderConfirmationPayload {
  orderId: string;
  orderNumber: string;
  email: string;
  currencyCode: string;
  items: Array<{
    title: string;
    sku: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
  }>;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  shippingAddress: Record<string, unknown>;
}

/** 发货通知的数据。 */
export interface ShipmentNotificationPayload {
  orderId: string;
  orderNumber: string;
  email: string;
  carrier: string;
  trackingNumber: string;
  items: Array<{ title: string; quantity: number }>;
  shippedAt: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** 发信端口：SMTP 实现与测试替身共用。 */
export interface NotificationTransport {
  send(msg: EmailMessage): Promise<void>;
}

/** 落库行（未映射前）。 */
export interface NotificationRow {
  id: string;
  template: NotificationTemplate;
  to_email: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  order_id: string | null;
  dedupe_key: string;
  next_attempt_at: Date | null;
  created_at: Date;
  sent_at: Date | null;
}

/** 落库形态：比 DTO 多一份加密后的密码（只在仓储/服务内部流转）。 */
export interface NotificationSettingsRecord extends NotificationSettingsDTO {
  smtp_password_enc: string | null;
}

export interface NotificationRepository {
  getSettings(): Promise<NotificationSettingsRecord | null>;
  upsertSettings(
    patch: Partial<NotificationSettingsDTO> & { smtp_password_enc?: string | null },
  ): Promise<NotificationSettingsRecord>;
  /** 幂等插入：dedupe_key 冲突时返回 null（事件重放不重复发）。 */
  insertIfAbsent(row: Omit<NotificationRow, "created_at" | "sent_at" | "next_attempt_at">): Promise<NotificationRow | null>;
  /** 原子领取一批待发（FOR UPDATE SKIP LOCKED，多进程安全）。 */
  claimBatch(limit: number): Promise<NotificationRow[]>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, error: string, retryDelaySeconds: number | null): Promise<void>;
  resetForResend(id: string): Promise<NotificationRow | null>;
  findById(id: string): Promise<NotificationRow | null>;
  list(q: { limit: number; offset: number; status?: NotificationStatus }): Promise<{
    items: NotificationRow[];
    count: number;
  }>;
}

/** 对外服务契约（组合根与路由只依赖它）。 */
export interface INotificationModuleService {
  getSettings(): Promise<NotificationSettingsDTO>;
  updateSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettingsDTO>;
  /** 幂等：事件重放不会重复发信。 */
  enqueueOrderConfirmation(payload: OrderConfirmationPayload): Promise<void>;
  enqueueShipmentNotification(
    fulfillmentId: string,
    payload: ShipmentNotificationPayload,
  ): Promise<void>;
  /** 管理后台「测试发送」：失败抛可读业务错误。 */
  sendTest(to: string): Promise<void>;
  list(q: {
    limit: number;
    offset: number;
    status?: NotificationStatus;
  }): Promise<{ items: NotificationDTO[]; count: number }>;
  resend(id: string): Promise<NotificationDTO>;
  /** 以下两个由派发器调用，不属于业务接口。 */
  claimPending(limit: number): Promise<NotificationRow[]>;
  deliverRow(row: NotificationRow, opts?: { autoRetry?: boolean }): Promise<void>;
}
