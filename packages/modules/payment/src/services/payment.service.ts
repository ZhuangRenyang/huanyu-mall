import { prefixedUlid } from "@mall/core";
import { decryptOptions, encryptOptions } from "./encryption.js";
import {
  collectionNotFound,
  paymentNotFound,
  paymentStateInvalid,
  providerNotFound,
  sessionNotFound,
  WebhookSignatureError,
  webhookVerificationFailed,
} from "../errors.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { PaymentProviderDescriptor, WebhookActionResult } from "../providers/types.js";
import type {
  CreateCollectionInput,
  CreateSessionInput,
  IPaymentModuleService,
  PaymentCollectionDTO,
  PaymentDTO,
  PaymentRepository,
  PaymentSessionDTO,
  RefundDTO,
  RefundInput,
  ProviderConfigView,
  WebhookResultDTO,
} from "../types.js";

export interface PaymentServiceDeps {
  repo: PaymentRepository;
  registry: ProviderRegistry;
  /** 返回解密后的 provider 配置（未配置返回 null）。生产接 AES-GCM 解密，测试注入 map。 */
  resolveProviderConfig: (identifier: string) => Promise<Record<string, unknown> | null>;
  /**
   * 领域事件发射端口（组合根接 EventBus）。
   * payment 不依赖 order：支付成功后发 payment.captured，由 subscriber 驱动订单状态迁移（铁律：模块间只走事件/工作流）。
   */
  emit?: (event: { name: string; data: Record<string, unknown> }) => Promise<void>;
}

/** M06 对外门面。验签失败 401 不落库（坑 8）；退款幂等；金额只在 Provider 边界转换（坑 11）。 */
export class PaymentService implements IPaymentModuleService {
  constructor(private readonly deps: PaymentServiceDeps) {}

  async listEnabledProviders(channelId: string): Promise<PaymentProviderDescriptor[]> {
    const ids = await this.deps.repo.enabledProviderIdsByChannel(channelId);
    return ids
      .map((id) => this.deps.registry.descriptor(id))
      .filter((d): d is PaymentProviderDescriptor => d !== null);
  }

  async createPaymentCollection(input: CreateCollectionInput): Promise<PaymentCollectionDTO> {
    return this.deps.repo.insertCollection({ ...input, id: prefixedUlid("paycol"), status: "not_paid" });
  }

  async createSession(input: CreateSessionInput): Promise<PaymentSessionDTO> {
    const collection = await this.deps.repo.findCollection(input.paymentCollectionId);
    if (!collection) throw collectionNotFound(input.paymentCollectionId);
    const provider = await this.loadProvider(input.providerId);
    const initiated = await provider.initiatePayment({
      sessionId: collection.id,
      amountMinor: collection.amount_minor,
      currencyCode: collection.currency_code,
    });
    return this.deps.repo.insertSession({
      id: prefixedUlid("paysess"),
      paymentCollectionId: collection.id,
      providerId: input.providerId,
      status: "pending",
      amountMinor: collection.amount_minor,
      currencyCode: collection.currency_code,
      providerReference: initiated.providerReference,
      context: {
        kind: initiated.kind,
        qrcode: initiated.qrcode ?? null,
        redirectUrl: initiated.redirectUrl ?? null,
        clientSecret: initiated.clientSecret ?? null,
      },
    });
  }

  async findCollectionByOrderId(orderId: string): Promise<PaymentCollectionDTO | null> {
    return this.deps.repo.findCollectionByOrderId(orderId);
  }

  async authorizeSession(sessionId: string): Promise<PaymentDTO> {
    const session = await this.deps.repo.findSession(sessionId);
    if (!session) throw sessionNotFound(sessionId);
    if (session.status !== "pending" && session.status !== "requires_more") {
      throw paymentStateInvalid(sessionId, session.status);
    }
    const provider = await this.loadProvider(session.provider_id);
    const result = await provider.authorizePayment({
      sessionId: session.id,
      amountMinor: session.amount_minor,
      currencyCode: session.currency_code,
      providerReference: session.provider_reference ?? undefined,
    });
    if (result.status === "failed") {
      await this.deps.repo.updateSessionStatus(session.id, "failed");
      throw paymentStateInvalid(session.id, "authorize_failed");
    }
    const payment = await this.deps.repo.insertPayment({
      id: prefixedUlid("pay"),
      paymentCollectionId: session.payment_collection_id,
      sessionId: session.id,
      amountMinor: session.amount_minor,
      currencyCode: session.currency_code,
      status: "authorized",
      providerId: session.provider_id,
      providerReference: result.providerReference,
    });
    await this.deps.repo.updateSessionStatus(session.id, "authorized", result.providerReference);
    await this.deps.repo.updateCollectionStatus(session.payment_collection_id, "authorized");
    await this.deps.repo.insertTransaction({
      paymentId: payment.id,
      type: "authorize",
      amountMinor: session.amount_minor,
      currencyCode: session.currency_code,
      status: "succeeded",
      providerReference: result.providerReference,
      idempotencyKey: `${session.id}:authorize`,
    });
    return payment;
  }

  async capturePayment(paymentId: string, amountMinor: bigint, idempotencyKey: string): Promise<PaymentDTO> {
    const payment = await this.deps.repo.findPayment(paymentId);
    if (!payment) throw paymentNotFound(paymentId);
    if (payment.status === "captured") return payment; // 幂等
    if (payment.status !== "authorized" && payment.status !== "pending") {
      throw paymentStateInvalid(paymentId, payment.status);
    }
    const provider = await this.loadProvider(payment.provider_id);
    // 金额以 payment 记录为准：调用方未指定（0）时兜底取记录金额，避免支付流水金额记成 0
    const amount = amountMinor > 0n ? amountMinor : payment.amount_minor;
    const result = await provider.capturePayment({
      paymentId,
      amountMinor: amount,
      currencyCode: payment.currency_code,
      providerReference: payment.provider_reference ?? undefined,
      idempotencyKey,
    });
    if (result.status === "failed") throw paymentStateInvalid(paymentId, "capture_failed");
    await this.deps.repo.updatePaymentStatus(paymentId, "captured", new Date());
    // 扣款成功 → 发 payment.captured（subscriber 驱动 order.transition(paid)）
    await this.emitCaptured({ paymentId, amountMinor: amount });
    await this.deps.repo.insertTransaction({
      paymentId,
      type: "capture",
      amountMinor: amount,
      currencyCode: payment.currency_code,
      status: "succeeded",
      providerReference: result.providerReference,
      idempotencyKey,
    });
    return (await this.deps.repo.findPayment(paymentId))!;
  }

  async refundPayment(input: RefundInput): Promise<RefundDTO> {
    const existing = await this.deps.repo.findRefundByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing; // 幂等
    const payment = await this.deps.repo.findPayment(input.paymentId);
    if (!payment) throw paymentNotFound(input.paymentId);
    if (payment.status !== "captured") throw paymentStateInvalid(input.paymentId, payment.status);
    const provider = await this.loadProvider(payment.provider_id);
    const result = await provider.refundPayment({
      paymentId: input.paymentId,
      amountMinor: input.amountMinor,
      currencyCode: payment.currency_code,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      providerReference: payment.provider_reference ?? undefined,
    });
    const refund = await this.deps.repo.insertRefund({
      id: prefixedUlid("rfd"),
      paymentId: input.paymentId,
      amountMinor: input.amountMinor,
      currencyCode: payment.currency_code,
      reason: input.reason ?? null,
      status: result.status === "succeeded" ? "succeeded" : "failed",
      providerReference: result.providerReference,
      idempotencyKey: input.idempotencyKey,
    });
    await this.deps.repo.insertTransaction({
      paymentId: input.paymentId,
      type: "refund",
      amountMinor: input.amountMinor,
      currencyCode: payment.currency_code,
      status: result.status === "succeeded" ? "succeeded" : "failed",
      providerReference: result.providerReference,
      idempotencyKey: input.idempotencyKey,
    });
    if (result.status === "succeeded") await this.deps.repo.updatePaymentStatus(input.paymentId, "refunded");
    return refund;
  }

  async cancelPayment(paymentId: string): Promise<void> {
    const payment = await this.deps.repo.findPayment(paymentId);
    if (!payment) throw paymentNotFound(paymentId);
    const provider = await this.loadProvider(payment.provider_id);
    await provider.cancelPayment({ paymentId, providerReference: payment.provider_reference ?? undefined });
    await this.deps.repo.updatePaymentStatus(paymentId, "canceled");
    await this.deps.repo.insertTransaction({
      paymentId,
      type: "cancel",
      amountMinor: payment.amount_minor,
      currencyCode: payment.currency_code,
      status: "succeeded",
      idempotencyKey: `${paymentId}:cancel`,
    });
  }

  async handleProviderWebhook(
    providerId: string,
    raw: { headers: Record<string, string>; rawBody: string },
  ): Promise<WebhookResultDTO> {
    const provider = await this.loadProvider(providerId);
    let result: WebhookActionResult;
    try {
      result = await provider.getWebhookActionAndData(raw);
    } catch (err) {
      if (err instanceof WebhookSignatureError) throw webhookVerificationFailed(); // 40005 → 401，不落库
      throw err;
    }
    const inserted = await this.deps.repo.insertWebhookEvent({
      id: prefixedUlid("pwebhook"),
      providerId,
      eventId: result.eventId,
      // payload 存 jsonb，BigInt 不可序列化 → 转 number（一期金额 < 2^53 安全）
      payload: JSON.parse(
        JSON.stringify({ action: result.action, data: result.data }, (_k, v) =>
          typeof v === "bigint" ? Number(v) : v,
        ),
      ) as Record<string, unknown>,
      raw: raw.rawBody,
    });
    if (!inserted) return { eventId: result.eventId, action: result.action, duplicate: true };
    await this.applyWebhookAction(result);
    await this.deps.repo.markWebhookProcessed(providerId, result.eventId);
    return { eventId: result.eventId, action: result.action, duplicate: false };
  }

  private async applyWebhookAction(result: WebhookActionResult): Promise<void> {
    const data = result.data ?? {};
    if (result.action === "captured" && data.paymentId) {
      await this.deps.repo.updatePaymentStatus(data.paymentId, "captured", new Date());
      await this.emitCaptured(data);
      return;
    }
    if (result.action === "authorized" && data.sessionId) {
      await this.deps.repo.updateSessionStatus(data.sessionId, "authorized");
      return;
    }
    if ((result.action === "failed" || result.action === "canceled") && data.paymentId) {
      await this.deps.repo.updatePaymentStatus(data.paymentId, result.action === "failed" ? "failed" : "canceled");
    }
  }

  /** 扣款成功 → 发 payment.captured 领域事件（由 subscriber 驱动 order.transition(paid)，payment 不依赖 order）。 */
  private async emitCaptured(data: NonNullable<WebhookActionResult["data"]>): Promise<void> {
    if (!this.deps.emit) return;
    const payment = await this.deps.repo.findPayment(data.paymentId!);
    const collection = payment
      ? await this.deps.repo.findCollection(payment.payment_collection_id)
      : null;
    await this.deps.emit({
      name: "payment.captured",
      data: {
        paymentId: data.paymentId,
        orderId: collection?.order_id ?? null,
        // 事件走 outbox(jsonb)，BigInt 不可序列化 → 转 number
        amountMinor: data.amountMinor !== undefined ? Number(data.amountMinor) : null,
      },
    });
  }

  private async loadProvider(identifier: string) {
    if (!this.deps.registry.descriptor(identifier)) throw providerNotFound(identifier);
    const config = (await this.deps.resolveProviderConfig(identifier)) ?? {};
    return this.deps.registry.load(identifier, config);
  }

  /** 后台填密钥：AES-256-GCM 加密写库 + 按 channel 启用；返回掩码视图。 */
  async configureProvider(input: {
    identifier: string;
    options: Record<string, unknown>;
    enabledChannels?: string[];
  }): Promise<ProviderConfigView> {
    const encrypted = encryptOptions(input.options);
    const cfg = await this.deps.repo.upsertProviderConfig({
      identifier: input.identifier,
      label: input.identifier,
      optionsEncrypted: encrypted,
      isEnabled: true,
    });
    for (const channelId of input.enabledChannels ?? []) {
      await this.deps.repo.setProviderChannelEnabled(cfg.id, channelId, true);
    }
    return {
      identifier: input.identifier,
      label: cfg.label,
      is_enabled: true,
      options_masked: maskOptions(input.options),
    };
  }

  /** 回显只返回掩码（末 4 位），绝不回明文。 */
  async getProviderConfig(identifier: string): Promise<ProviderConfigView | null> {
    const cfg = await this.deps.repo.findProviderConfig(identifier);
    if (!cfg) return null;
    let options: Record<string, unknown> = {};
    if (cfg.optionsEncrypted) {
      try {
        options = decryptOptions(cfg.optionsEncrypted);
      } catch {
        options = {};
      }
    }
    return {
      identifier,
      label: cfg.label,
      is_enabled: cfg.isEnabled,
      options_masked: maskOptions(options),
    };
  }
}

function maskOptions(options: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(options)) {
    const s = typeof value === "string" ? value : String(value ?? "");
    out[key] = s.length > 4 ? `****${s.slice(-4)}` : "****";
  }
  return out;
}
