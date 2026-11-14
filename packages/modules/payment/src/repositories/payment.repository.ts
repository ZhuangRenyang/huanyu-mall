import { and, eq, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  CollectionStatus,
  CreateCollectionInput,
  PaymentCollectionDTO,
  PaymentDTO,
  PaymentRepository,
  PaymentSessionDTO,
  PaymentStatus,
  RefundDTO,
  RefundStatus,
  SessionStatus,
  TransactionStatus,
  TransactionType,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly db: Db) {}

  async insertCollection(input: CreateCollectionInput & { id: string; status: CollectionStatus }): Promise<PaymentCollectionDTO> {
    const rows = await this.db
      .insert(schema.paymentCollection)
      .values({
        id: input.id,
        cartId: input.cartId ?? null,
        orderId: input.orderId ?? null,
        currencyCode: input.currencyCode,
        amountMinor: input.amountMinor,
        status: input.status,
      })
      .returning();
    return toCollectionDTO(rows[0]!);
  }

  async findCollection(id: string): Promise<PaymentCollectionDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.paymentCollection)
      .where(and(eq(schema.paymentCollection.id, id), isNull(schema.paymentCollection.deletedAt)))
      .limit(1);
    return rows[0] ? toCollectionDTO(rows[0]) : null;
  }

  /** 按订单反查支付集合（集合由 cart-complete workflow 建，带 order_id + 正确金额）。 */
  async findCollectionByOrderId(orderId: string): Promise<PaymentCollectionDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.paymentCollection)
      .where(
        and(
          eq(schema.paymentCollection.orderId, orderId),
          isNull(schema.paymentCollection.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toCollectionDTO(rows[0]) : null;
  }

  /**
   * 按支付集合反查支付单。
   *
   * 为什么需要这个：支付商回调里带回的 `paymentId` 是**支付商侧交易号**
   * （支付宝 trade_no / PayPal capture id），与我们内部的 `payment.id`（pay_xxx）
   * **不在同一个 ID 空间**。直接拿它去 updatePaymentStatus 会更新不到任何行 ——
   * 症状是「回调返回 200、审计表有记录，但订单永远停在 pending/unpaid」，极难察觉。
   *
   * 可信锚点是**商户单号**：发起支付时我们把 `payment_collection.id` 当商户单号传给了
   * 支付商（支付宝 out_trade_no / PayPal custom_id），支付商会原样回传，
   * 经 collection 反查就能定位到真正的支付单。
   */
  async findPaymentByCollectionId(collectionId: string): Promise<PaymentDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.payment)
      .where(
        and(
          eq(schema.payment.paymentCollectionId, collectionId),
          isNull(schema.payment.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toPaymentDTO(rows[0]) : null;
  }

  async updateCollectionStatus(id: string, status: CollectionStatus): Promise<void> {
    await this.db.update(schema.paymentCollection).set({ status, updatedAt: new Date() }).where(eq(schema.paymentCollection.id, id));
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
    const rows = await this.db
      .insert(schema.paymentSession)
      .values({
        id: input.id,
        paymentCollectionId: input.paymentCollectionId,
        providerId: input.providerId,
        status: input.status,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
        providerReference: input.providerReference ?? null,
        context: input.context ?? null,
      })
      .returning();
    return toSessionDTO(rows[0]!);
  }

  async findSession(id: string): Promise<PaymentSessionDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.paymentSession)
      .where(and(eq(schema.paymentSession.id, id), isNull(schema.paymentSession.deletedAt)))
      .limit(1);
    return rows[0] ? toSessionDTO(rows[0]) : null;
  }

  async updateSessionStatus(id: string, status: SessionStatus, providerReference?: string | null): Promise<void> {
    const set: Record<string, unknown> = { status, updatedAt: new Date() };
    if (providerReference !== undefined) set.providerReference = providerReference;
    await this.db.update(schema.paymentSession).set(set).where(eq(schema.paymentSession.id, id));
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
    const rows = await this.db
      .insert(schema.payment)
      .values({
        id: input.id,
        paymentCollectionId: input.paymentCollectionId,
        sessionId: input.sessionId ?? null,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
        status: input.status,
        providerId: input.providerId,
        providerReference: input.providerReference ?? null,
      })
      .returning();
    return toPaymentDTO(rows[0]!);
  }

  async findPayment(id: string): Promise<PaymentDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.payment)
      .where(and(eq(schema.payment.id, id), isNull(schema.payment.deletedAt)))
      .limit(1);
    return rows[0] ? toPaymentDTO(rows[0]) : null;
  }

  async updatePaymentStatus(id: string, status: PaymentStatus, capturedAt?: Date | null): Promise<void> {
    const set: Record<string, unknown> = { status, updatedAt: new Date() };
    if (capturedAt !== undefined) set.capturedAt = capturedAt;
    await this.db.update(schema.payment).set(set).where(eq(schema.payment.id, id));
  }

  async insertTransaction(input: {
    paymentId: string;
    type: TransactionType;
    amountMinor: bigint;
    currencyCode: string;
    status: TransactionStatus;
    providerReference?: string | null;
    idempotencyKey: string;
  }): Promise<void> {
    await this.db
      .insert(schema.paymentTransaction)
      .values({
        id: prefixedUlid("paytxn"),
        paymentId: input.paymentId,
        type: input.type,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
        status: input.status,
        providerReference: input.providerReference ?? null,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing();
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
    const rows = await this.db
      .insert(schema.refund)
      .values({
        id: input.id,
        paymentId: input.paymentId,
        orderId: input.orderId ?? null,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
        reason: input.reason ?? null,
        status: input.status,
        providerReference: input.providerReference ?? null,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    return toRefundDTO(rows[0]!);
  }

  async findRefundByIdempotencyKey(key: string): Promise<RefundDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.refund)
      .where(and(eq(schema.refund.idempotencyKey, key), isNull(schema.refund.deletedAt)))
      .limit(1);
    return rows[0] ? toRefundDTO(rows[0]) : null;
  }

  async enabledProviderIdsByChannel(channelId: string): Promise<string[]> {
    const res = await this.db.execute(
      sql`SELECT c.identifier FROM payment_provider_channel lk
          JOIN payment_provider_config c ON c.id = lk.provider_config_id
          WHERE lk.channel_id = ${channelId} AND lk.is_enabled = true AND lk.deleted_at IS NULL
            AND c.is_enabled = true AND c.deleted_at IS NULL
          ORDER BY lk.sort_order ASC`,
    );
    return (res.rows as Array<Record<string, unknown>>).map((r) => String(r.identifier));
  }

  async insertWebhookEvent(input: {
    id: string;
    providerId: string;
    eventId: string;
    payload: Record<string, unknown>;
    raw: string;
  }): Promise<boolean> {
    const rows = await this.db
      .insert(schema.providerWebhookEvent)
      .values({
        id: input.id,
        providerId: input.providerId,
        eventId: input.eventId,
        payload: input.payload,
        raw: { body: input.raw },
      })
      .onConflictDoNothing()
      .returning({ id: schema.providerWebhookEvent.id });
    return rows.length > 0;
  }

  async markWebhookProcessed(providerId: string, eventId: string): Promise<void> {
    await this.db
      .update(schema.providerWebhookEvent)
      .set({ processed: true, processedAt: new Date() })
      .where(
        and(
          eq(schema.providerWebhookEvent.providerId, providerId),
          eq(schema.providerWebhookEvent.eventId, eventId),
        ),
      );
  }

  async listProviderConfigs(): Promise<
    Array<{ identifier: string; label: string; optionsEncrypted: string | null; isEnabled: boolean }>
  > {
    const rows = await this.db
      .select()
      .from(schema.paymentProviderConfig)
      .where(isNull(schema.paymentProviderConfig.deletedAt));
    return rows.map((r) => ({
      identifier: r.identifier,
      label: r.label,
      optionsEncrypted: r.optionsEncrypted ?? null,
      isEnabled: r.isEnabled,
    }));
  }

  async findProviderConfig(identifier: string): Promise<{
    identifier: string;
    label: string;
    optionsEncrypted: string | null;
    isEnabled: boolean;
  } | null> {
    const rows = await this.db
      .select()
      .from(schema.paymentProviderConfig)
      .where(
        and(eq(schema.paymentProviderConfig.identifier, identifier), isNull(schema.paymentProviderConfig.deletedAt)),
      )
      .limit(1);
    const r = rows[0];
    return r
      ? { identifier: r.identifier, label: r.label, optionsEncrypted: r.optionsEncrypted ?? null, isEnabled: r.isEnabled }
      : null;
  }

  async upsertProviderConfig(input: {
    identifier: string;
    label: string;
    optionsEncrypted: string;
    isEnabled: boolean;
  }): Promise<{ id: string; label: string }> {
    const existing = await this.db
      .select({ id: schema.paymentProviderConfig.id })
      .from(schema.paymentProviderConfig)
      .where(
        and(eq(schema.paymentProviderConfig.identifier, input.identifier), isNull(schema.paymentProviderConfig.deletedAt)),
      )
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(schema.paymentProviderConfig)
        .set({ label: input.label, optionsEncrypted: input.optionsEncrypted, isEnabled: input.isEnabled, updatedAt: new Date() })
        .where(eq(schema.paymentProviderConfig.id, existing[0].id));
      return { id: existing[0].id, label: input.label };
    }
    const rows = await this.db
      .insert(schema.paymentProviderConfig)
      .values({
        id: prefixedUlid("pp"),
        identifier: input.identifier,
        label: input.label,
        optionsEncrypted: input.optionsEncrypted,
        isEnabled: input.isEnabled,
      })
      .returning();
    return { id: rows[0]!.id, label: rows[0]!.label };
  }

  async setProviderChannelEnabled(configId: string, channelId: string, enabled: boolean): Promise<void> {
    const upd = await this.db.execute(
      sql`UPDATE payment_provider_channel SET is_enabled = ${enabled}, updated_at = now()
          WHERE provider_config_id = ${configId} AND channel_id = ${channelId} AND deleted_at IS NULL`,
    );
    if ((upd.rowCount ?? 0) === 0) {
      await this.db.execute(
        sql`INSERT INTO payment_provider_channel (id, provider_config_id, channel_id, is_enabled)
            VALUES (${prefixedUlid("lnk")}, ${configId}, ${channelId}, ${enabled})`,
      );
    }
  }

  /** composition root 用：取加密配置（不在 PaymentRepository 接口内）。 */
  async findProviderConfigEncrypted(identifier: string): Promise<string | null> {
    const rows = await this.db
      .select({ optionsEncrypted: schema.paymentProviderConfig.optionsEncrypted })
      .from(schema.paymentProviderConfig)
      .where(and(eq(schema.paymentProviderConfig.identifier, identifier), isNull(schema.paymentProviderConfig.deletedAt)))
      .limit(1);
    return rows[0]?.optionsEncrypted ?? null;
  }
}

function toCollectionDTO(r: typeof schema.paymentCollection.$inferSelect): PaymentCollectionDTO {
  return {
    id: r.id,
    cart_id: r.cartId ?? null,
    order_id: r.orderId ?? null,
    currency_code: r.currencyCode,
    amount_minor: r.amountMinor,
    status: r.status as CollectionStatus,
  };
}

function toSessionDTO(r: typeof schema.paymentSession.$inferSelect): PaymentSessionDTO {
  return {
    id: r.id,
    payment_collection_id: r.paymentCollectionId,
    provider_id: r.providerId,
    status: r.status as SessionStatus,
    amount_minor: r.amountMinor,
    currency_code: r.currencyCode,
    provider_reference: r.providerReference ?? null,
    context: (r.context as Record<string, unknown> | null) ?? null,
  };
}

function toPaymentDTO(r: typeof schema.payment.$inferSelect): PaymentDTO {
  return {
    id: r.id,
    payment_collection_id: r.paymentCollectionId,
    session_id: r.sessionId ?? null,
    amount_minor: r.amountMinor,
    currency_code: r.currencyCode,
    status: r.status as PaymentStatus,
    provider_id: r.providerId,
    provider_reference: r.providerReference ?? null,
    captured_at: r.capturedAt ? r.capturedAt.toISOString() : null,
  };
}

function toRefundDTO(r: typeof schema.refund.$inferSelect): RefundDTO {
  return {
    id: r.id,
    payment_id: r.paymentId,
    amount_minor: r.amountMinor,
    currency_code: r.currencyCode,
    status: r.status as RefundStatus,
    provider_reference: r.providerReference ?? null,
  };
}
