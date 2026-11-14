/** M06 Payment DTO 与契约（对齐架构 §2.1）。 */

export type CollectionStatus = "not_paid" | "awaiting" | "authorized" | "captured" | "partially_refunded" | "refunded";
export type SessionStatus = "pending" | "requires_more" | "authorized" | "captured" | "failed" | "canceled" | "expired";
export type PaymentStatus = "pending" | "authorized" | "captured" | "failed" | "canceled" | "refunded";
export type TransactionType = "authorize" | "capture" | "refund" | "cancel" | "void";
export type TransactionStatus = "pending" | "succeeded" | "failed";
export type RefundStatus = "pending" | "succeeded" | "failed";

export interface PaymentCollectionDTO {
  id: string;
  cart_id: string | null;
  order_id: string | null;
  currency_code: string;
  amount_minor: bigint;
  status: CollectionStatus;
}

export interface PaymentSessionDTO {
  id: string;
  payment_collection_id: string;
  provider_id: string;
  status: SessionStatus;
  amount_minor: bigint;
  currency_code: string;
  provider_reference: string | null;
  context: Record<string, unknown> | null;
}

export interface PaymentDTO {
  id: string;
  payment_collection_id: string;
  session_id: string | null;
  amount_minor: bigint;
  currency_code: string;
  status: PaymentStatus;
  provider_id: string;
  provider_reference: string | null;
  captured_at: string | null;
}

export interface RefundDTO {
  id: string;
  payment_id: string;
  amount_minor: bigint;
  currency_code: string;
  status: RefundStatus;
  provider_reference: string | null;
}

export interface CreateCollectionInput {
  cartId?: string | null;
  orderId?: string | null;
  currencyCode: string;
  amountMinor: bigint;
}

export interface CreateSessionInput {
  paymentCollectionId: string;
  providerId: string;
  /** 支付完成后回跳地址（PayPal 必填：缺了用户付完款无处可去）。 */
  returnUrl?: string;
  /** 传给 provider 的附加信息（如支付标题 subject）。 */
  metadata?: Record<string, unknown>;
}

export interface RefundInput {
  paymentId: string;
  amountMinor: bigint;
  reason?: string;
  idempotencyKey: string;
}

export interface WebhookResultDTO {
  eventId: string;
  action: string;
  duplicate: boolean;
}

export interface InsertTransactionInput {
  paymentId: string;
  type: TransactionType;
  amountMinor: bigint;
  currencyCode: string;
  status: TransactionStatus;
  providerReference?: string | null;
  idempotencyKey: string;
}

export interface PaymentRepository {
  insertCollection(input: CreateCollectionInput & { id: string; status: CollectionStatus }): Promise<PaymentCollectionDTO>;
  findCollection(id: string): Promise<PaymentCollectionDTO | null>;
  findCollectionByOrderId(orderId: string): Promise<PaymentCollectionDTO | null>;
  updateCollectionStatus(id: string, status: CollectionStatus): Promise<void>;
  insertSession(input: {
    id: string;
    paymentCollectionId: string;
    providerId: string;
    status: SessionStatus;
    amountMinor: bigint;
    currencyCode: string;
    providerReference?: string | null;
    context?: Record<string, unknown> | null;
  }): Promise<PaymentSessionDTO>;
  findSession(id: string): Promise<PaymentSessionDTO | null>;
  updateSessionStatus(id: string, status: SessionStatus, providerReference?: string | null): Promise<void>;
  insertPayment(input: {
    id: string;
    paymentCollectionId: string;
    sessionId?: string | null;
    amountMinor: bigint;
    currencyCode: string;
    status: PaymentStatus;
    providerId: string;
    providerReference?: string | null;
  }): Promise<PaymentDTO>;
  findPayment(id: string): Promise<PaymentDTO | null>;
  /**
   * 按支付集合（商户单号）反查支付单。
   *
   * 支付商回调带回的 `paymentId` 是**支付商侧交易号**（支付宝 trade_no / PayPal capture id），
   * 与我们内部的 `payment.id`（pay_xxx）不在同一 ID 空间；可靠锚点是商户单号
   * （= `payment_collection.id`，发起支付时原样传给支付商、回调原样带回）。
   */
  findPaymentByCollectionId(collectionId: string): Promise<PaymentDTO | null>;
  updatePaymentStatus(id: string, status: PaymentStatus, capturedAt?: Date | null): Promise<void>;
  insertTransaction(input: InsertTransactionInput): Promise<void>;
  insertRefund(input: {
    id: string;
    paymentId: string;
    orderId?: string | null;
    amountMinor: bigint;
    currencyCode: string;
    reason?: string | null;
    status: RefundStatus;
    providerReference?: string | null;
    idempotencyKey: string;
  }): Promise<RefundDTO>;
  findRefundByIdempotencyKey(key: string): Promise<RefundDTO | null>;
  /** 该渠道启用的 provider id（payment_provider_channel link + 全局 is_enabled）。 */
  enabledProviderIdsByChannel(channelId: string): Promise<string[]>;
  /** 唯一去重：已存在返回 false。 */
  insertWebhookEvent(input: {
    id: string;
    providerId: string;
    eventId: string;
    payload: Record<string, unknown>;
    raw: string;
  }): Promise<boolean>;
  markWebhookProcessed(providerId: string, eventId: string): Promise<void>;
  findProviderConfig(identifier: string): Promise<{
    identifier: string;
    label: string;
    optionsEncrypted: string | null;
    isEnabled: boolean;
  } | null>;
  /** 全部通道配置（后台列表；不含明文密钥）。 */
  listProviderConfigs(): Promise<Array<{
    identifier: string;
    label: string;
    optionsEncrypted: string | null;
    isEnabled: boolean;
  }>>;
  upsertProviderConfig(input: {
    identifier: string;
    label: string;
    optionsEncrypted: string;
    isEnabled: boolean;
  }): Promise<{ id: string; label: string }>;
  setProviderChannelEnabled(configId: string, channelId: string, enabled: boolean): Promise<void>;
}

export interface ProviderConfigView {
  identifier: string;
  label: string;
  is_enabled: boolean;
  options_masked: Record<string, string>;
}

export interface IPaymentModuleService {
  listEnabledProviders(channelId: string): Promise<import("./providers/types.js").PaymentProviderDescriptor[]>;
  createPaymentCollection(input: CreateCollectionInput): Promise<PaymentCollectionDTO>;
  /** 按订单反查支付集合（复用 workflow 建好的集合，避免旁路新建 order_id 为空的空壳）。 */
  findCollectionByOrderId(orderId: string): Promise<PaymentCollectionDTO | null>;
  /** 按订单反查支付单（退款时要知道退哪一笔，避免调用方拼两步查询）。 */
  findPaymentByOrderId(orderId: string): Promise<PaymentDTO | null>;
  createSession(input: CreateSessionInput): Promise<PaymentSessionDTO>;
  findCollectionById(id: string): Promise<PaymentCollectionDTO | null>;
  authorizeSession(sessionId: string): Promise<PaymentDTO>;
  capturePayment(paymentId: string, amountMinor: bigint, idempotencyKey: string): Promise<PaymentDTO>;
  refundPayment(input: RefundInput): Promise<RefundDTO>;
  cancelPayment(paymentId: string): Promise<void>;
  handleProviderWebhook(
    providerId: string,
    raw: { headers: Record<string, string>; rawBody: string },
  ): Promise<WebhookResultDTO>;
  configureProvider(input: {
    identifier: string;
    options: Record<string, unknown>;
    enabledChannels?: string[];
  }): Promise<ProviderConfigView>;
  getProviderConfig(identifier: string): Promise<ProviderConfigView | null>;
  /** 后台通道列表：四家都列出来，未配置的也要显示（否则商家以为只剩一家）。 */
  listProviderConfigs(): Promise<ProviderConfigView[]>;
}
