import type {
  CollectionStatus,
  CreateCollectionInput,
  InsertTransactionInput,
  PaymentCollectionDTO,
  PaymentDTO,
  PaymentRepository,
  PaymentSessionDTO,
  PaymentStatus,
  RefundDTO,
  RefundStatus,
  SessionStatus,
} from "../../src/types.js";

export class InMemoryPaymentRepository implements PaymentRepository {
  readonly collections = new Map<string, PaymentCollectionDTO>();
  readonly sessions = new Map<string, PaymentSessionDTO>();
  readonly payments = new Map<string, PaymentDTO>();
  readonly refunds = new Map<string, RefundDTO>();
  readonly refundsByIdem = new Map<string, RefundDTO>();
  readonly transactions: InsertTransactionInput[] = [];
  readonly webhookEvents = new Set<string>();
  readonly channelProviders = new Map<string, string[]>();
  private counter = 0;

  async insertCollection(input: CreateCollectionInput & { id: string; status: CollectionStatus }): Promise<PaymentCollectionDTO> {
    const dto: PaymentCollectionDTO = {
      id: input.id,
      cart_id: input.cartId ?? null,
      order_id: input.orderId ?? null,
      currency_code: input.currencyCode,
      amount_minor: input.amountMinor,
      status: input.status,
    };
    this.collections.set(dto.id, dto);
    return dto;
  }
  async findCollection(id: string): Promise<PaymentCollectionDTO | null> {
    return this.collections.get(id) ?? null;
  }
  async findCollectionByOrderId(orderId: string): Promise<PaymentCollectionDTO | null> {
    for (const c of this.collections.values()) {
      if (c.order_id === orderId) return c;
    }
    return null;
  }
  async updateCollectionStatus(id: string, status: CollectionStatus): Promise<void> {
    const c = this.collections.get(id);
    if (c) c.status = status;
  }
  async insertSession(input: {
    id: string;
    paymentCollectionId: string;
    providerId: string;
    status: SessionStatus;
    amountMinor: bigint;
    currencyCode: string;
    providerReference?: string | null;
    context?: Record<string, unknown> | null;
  }): Promise<PaymentSessionDTO> {
    const dto: PaymentSessionDTO = {
      id: input.id,
      payment_collection_id: input.paymentCollectionId,
      provider_id: input.providerId,
      status: input.status,
      amount_minor: input.amountMinor,
      currency_code: input.currencyCode,
      provider_reference: input.providerReference ?? null,
      context: input.context ?? null,
    };
    this.sessions.set(dto.id, dto);
    return dto;
  }
  async findSession(id: string): Promise<PaymentSessionDTO | null> {
    return this.sessions.get(id) ?? null;
  }
  async updateSessionStatus(id: string, status: SessionStatus, providerReference?: string | null): Promise<void> {
    const s = this.sessions.get(id);
    if (s) {
      s.status = status;
      if (providerReference !== undefined) s.provider_reference = providerReference;
    }
  }
  async insertPayment(input: {
    id: string;
    paymentCollectionId: string;
    sessionId?: string | null;
    amountMinor: bigint;
    currencyCode: string;
    status: PaymentStatus;
    providerId: string;
    providerReference?: string | null;
  }): Promise<PaymentDTO> {
    const dto: PaymentDTO = {
      id: input.id,
      payment_collection_id: input.paymentCollectionId,
      session_id: input.sessionId ?? null,
      amount_minor: input.amountMinor,
      currency_code: input.currencyCode,
      status: input.status,
      provider_id: input.providerId,
      provider_reference: input.providerReference ?? null,
      captured_at: null,
    };
    this.payments.set(dto.id, dto);
    return dto;
  }
  async findPayment(id: string): Promise<PaymentDTO | null> {
    return this.payments.get(id) ?? null;
  }
  async findPaymentByCollectionId(collectionId: string): Promise<PaymentDTO | null> {
    for (const p of this.payments.values()) {
      if (p.payment_collection_id === collectionId) return p;
    }
    return null;
  }
  async updatePaymentStatus(id: string, status: PaymentStatus, capturedAt?: Date | null): Promise<void> {
    const p = this.payments.get(id);
    if (p) {
      p.status = status;
      if (capturedAt !== undefined) p.captured_at = capturedAt ? capturedAt.toISOString() : null;
    }
  }
  async insertTransaction(input: InsertTransactionInput): Promise<void> {
    if (!this.transactions.some((t) => t.idempotencyKey === input.idempotencyKey)) this.transactions.push(input);
  }
  async insertRefund(input: {
    id: string;
    paymentId: string;
    orderId?: string | null;
    amountMinor: bigint;
    currencyCode: string;
    reason?: string | null;
    status: RefundStatus;
    providerReference?: string | null;
    idempotencyKey: string;
  }): Promise<RefundDTO> {
    const dto: RefundDTO = {
      id: input.id,
      payment_id: input.paymentId,
      amount_minor: input.amountMinor,
      currency_code: input.currencyCode,
      status: input.status,
      provider_reference: input.providerReference ?? null,
    };
    this.refunds.set(dto.id, dto);
    this.refundsByIdem.set(input.idempotencyKey, dto);
    return dto;
  }
  async findRefundByIdempotencyKey(key: string): Promise<RefundDTO | null> {
    return this.refundsByIdem.get(key) ?? null;
  }
  async enabledProviderIdsByChannel(channelId: string): Promise<string[]> {
    return this.channelProviders.get(channelId) ?? [];
  }
  async insertWebhookEvent(input: {
    id: string;
    providerId: string;
    eventId: string;
    payload: Record<string, unknown>;
    raw: string;
  }): Promise<boolean> {
    const key = `${input.providerId}:${input.eventId}`;
    if (this.webhookEvents.has(key)) return false;
    this.webhookEvents.add(key);
    return true;
  }
  async markWebhookProcessed(): Promise<void> {}
  get webhookEventCount(): number {
    return this.webhookEvents.size;
  }
  next(): number {
    return ++this.counter;
  }
}
