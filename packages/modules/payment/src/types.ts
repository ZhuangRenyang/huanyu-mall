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
  createSession(input: CreateSessionInput): Promise<PaymentSessionDTO>;
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
}
