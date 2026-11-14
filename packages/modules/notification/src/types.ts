/** M-notification 契约（ADR-016）。邮件是交易类通知，不是营销工具。 */

export type NotificationTemplate =
  | "order_confirmation"
  | "shipment_notification"
  /** 到货提醒（ADR-059）。 */
  | "stock_alert"
  /** 退款进度（ADR-072）。 */
  | "refund_update";
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
  /** 到货提醒邮件开关（ADR-059）。 */
  stock_alert_enabled: boolean;
  /** 退款进度邮件开关（ADR-072）。 */
  refund_enabled: boolean;
  /** 到货提醒有效期天数（ADR-089）。 */
  stock_alert_ttl_days: number;
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
  stock_alert_enabled?: boolean;
  refund_enabled?: boolean;
  stock_alert_ttl_days?: number;
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

/**
 * 到货提醒邮件的数据（ADR-059）。
 *
 * 只带「哪个商品、哪个规格」，不带价格也不带深链：
 * - 价格在补货后可能调过，写死旧价顾客点进去会发现不一致；
 * - 商品页要 locale/channel 才拼得对，硬拼一个错的链接比不给更糟，
 *   所以按钮指向店铺首页（与既有订单邮件同一做法）。
 */
export interface StockAlertPayload {
  /** 提醒单 id（去重用）。 */
  alertId: string;
  email: string;
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  /** 该次登记的创建时间（重新登记会刷新，用于去重键区分两次登记）。 */
  createdAt: string;
}

/**
 * 退款进度邮件（ADR-072）。
 *
 * 顾客提了售后，商家点同意或拒绝之后必须有回音；否则他只能自己回店铺看，
 * 看到的还是「待处理」，会以为商家没理他。
 */
export interface RefundUpdatePayload {
  refundRequestId: string;
  orderId: string;
  orderNumber: string;
  email: string;
  /** 申请金额（minor）：拒绝时也带上，顾客好核对是哪一单。 */
  amountMinor: number;
  currencyCode: string;
  /**
   * 结果档位：
   * - `return_agreed` 同意退货（钱还没退，等寄回）；
   * - `refunded` 已退款（仅退款同意 / 收到退货后打款）；
   * - `rejected` 未通过。
   */
  status: "return_agreed" | "refunded" | "rejected";
  /** 商家留言；拒绝时是拒绝理由。 */
  note: string | null;
  /** 退货地址（仅 return_agreed，取单据上的快照）。 */
  returnAddress: string | null;
  reviewedAt: string;
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
  /**
   * 到货提醒邮件入队（ADR-059）。
   *
   * 去重键含「该次登记的创建时间」：补货通知发出后顾客可以重新登记，
   * 重新登记会刷新创建时间，于是下一次补货能再收到一封 —— 而不是被第一次的去重键永久挡掉。
   */
  enqueueStockAlert(payload: StockAlertPayload): Promise<void>;
  /**
   * 退款进度邮件入队（ADR-072）。
   *
   * 三档结果各发一封：同意退货（附快照的退货地址）、已退款、已拒绝（附理由）。
   * 去重键含结果档位 —— 同一张单先「同意退货」再「已退款」，是两封不同的信。
   */
  enqueueRefundUpdate(payload: RefundUpdatePayload): Promise<void>;
  /** 管理后台「测试发送」：失败抛可读业务错误。 */
  sendTest(to: string): Promise<void>;
  /**
   * 通用发信（验证码等一次性邮件）：同步发送，失败抛可读错误。
   *
   * 与订单邮件共用同一份 SMTP 配置，但**不落 notification 表** ——
   * 验证码是 5 分钟就作废的短命内容，留档只会让派发表塞满噪声。
   */
  sendMail(input: EmailMessage): Promise<void>;
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
