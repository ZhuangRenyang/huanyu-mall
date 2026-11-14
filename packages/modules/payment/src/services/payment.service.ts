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

  /** 按订单反查支付单：退款流程要知道退哪一笔，不能让调用方自己拼两步查询。 */
  async findPaymentByOrderId(orderId: string): Promise<PaymentDTO | null> {
    const collection = await this.deps.repo.findCollectionByOrderId(orderId);
    if (!collection) return null;
    return this.deps.repo.findPaymentByCollectionId(collection.id);
  }

  async createSession(input: CreateSessionInput): Promise<PaymentSessionDTO> {
    const collection = await this.deps.repo.findCollection(input.paymentCollectionId);
    if (!collection) throw collectionNotFound(input.paymentCollectionId);
    const provider = await this.loadProvider(input.providerId);
    const initiated = await provider.initiatePayment({
      sessionId: collection.id,
      amountMinor: collection.amount_minor,
      currencyCode: collection.currency_code,
      /*
       * 回跳地址必须传给 provider：
       * - PayPal 的 `application_context.return_url / cancel_url` 就来自这里，
       *   不传则用户在 PayPal 付完款后无处可去（PayPal 会报缺少 return_url）。
       * - 支付宝 page.pay 的 return_url 同理（沙箱已支持，生产同样需要）。
       * 没有就退化成 provider 自身配置里的 returnUrl（后台可填），两者都没有则不传。
       */
      ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      /*
       * 支付标题/摘要：默认用商户单号，商家后台能看出这是哪一单。
       * metadata 由调用方（store 路由）按真实订单内容填充。
       */
      metadata: input.metadata ?? { subject: `订单 ${collection.id}` },
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

  /** 按支付集合 id 查（store 路由取支付标题时用）。 */
  async findCollectionById(id: string): Promise<PaymentCollectionDTO | null> {
    return this.deps.repo.findCollection(id);
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
    await this.applyWebhookAction(result, providerId);
    await this.deps.repo.markWebhookProcessed(providerId, result.eventId);
    return { eventId: result.eventId, action: result.action, duplicate: false };
  }

  private async applyWebhookAction(
    result: WebhookActionResult,
    providerId: string,
  ): Promise<void> {
    const data = result.data ?? {};
    if (result.action === "captured") {
      let payment = await this.resolvePaymentForWebhook(data);
      if (!payment) {
        /*
         * 回调到达时可能**还没有** payment 记录 —— 支付宝/PayPal 这类「付款即成功」的渠道，
         * 授权阶段只是查单确认（不创建支付单），而支付单是在 authorizeSession 授权成功后才创建的；
         * 时序上用户完全可能先付款、回调先到。
         *
         * 这里按商户单号（= collection.id，支付商原样回传）补建一条已支付的支付单。
         * 幂等由 eventId 去重保证（同一事件只会处理一次）。
         */
        if (!data.sessionId) {
          throw new Error(
            `支付回调无法定位支付单（支付商交易号=${data.paymentId ?? '-'}，商户单号缺失）`,
          );
        }
        const collection = await this.deps.repo.findCollection(data.sessionId);
        if (!collection) {
          throw new Error(`支付回调无法定位支付集合（商户单号=${data.sessionId}）`);
        }
        const existing = await this.deps.repo.findPaymentByCollectionId(data.sessionId);
        payment =
          existing ??
          (await this.deps.repo.insertPayment({
            id: prefixedUlid("pay"),
            paymentCollectionId: collection.id,
            sessionId: null,
            amountMinor: collection.amount_minor,
            currencyCode: collection.currency_code,
            status: "captured",
            providerId,
            providerReference: data.paymentId ?? null,
          }));
      }
      await this.deps.repo.updatePaymentStatus(payment.id, "captured", new Date());
      await this.emitCaptured({ ...data, paymentId: payment.id });
      return;
    }
    if (result.action === "authorized" && data.sessionId) {
      await this.deps.repo.updateSessionStatus(data.sessionId, "authorized");
      return;
    }
    if (result.action === "failed" || result.action === "canceled") {
      /*
       * 失败/取消终态：定位不到时不影响资金（本来就没付成功），不抛错避免支付商无谓重试；
       * 该事件已经写进审计表（action + payload 可查），不算静默。
       */
      const payment = await this.resolvePaymentForWebhook(data);
      if (payment) {
        await this.deps.repo.updatePaymentStatus(
          payment.id,
          result.action === "failed" ? "failed" : "canceled",
        );
      }
    }
  }

  /**
   * 定位回调对应的支付单。
   *
   * 关键：**Provider 回传的 `paymentId` 是支付商侧交易号**（支付宝 trade_no、
   * PayPal capture id），与我们内部的 `payment.id`（pay_xxx）**不在同一 ID 空间**，
   * 拿它直接 updatePaymentStatus 什么也更新不到。
   *
   * 可信锚点是 `data.sessionId` —— 那正是发起支付时我们传给支付商的**商户单号**
   * （= `payment_collection.id`，支付宝 out_trade_no / PayPal custom_id），支付商原样回传，
   * 经 collection 反查即可定位到真正的支付单。
   *
   * 先按内部 id 直接命中一次，是为了兼容那些可能回传内部 id 的 provider。
   */
  private async resolvePaymentForWebhook(
    data: NonNullable<WebhookActionResult["data"]>,
  ): Promise<PaymentDTO | null> {
    if (data.paymentId) {
      const byId = await this.deps.repo.findPayment(data.paymentId);
      if (byId) return byId;
    }
    if (data.sessionId) {
      const byCollection = await this.deps.repo.findPaymentByCollectionId(data.sessionId);
      if (byCollection) return byCollection;
    }
    return null;
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
  async listProviderConfigs(): Promise<ProviderConfigView[]> {
    const rows = await this.deps.repo.listProviderConfigs();
    return rows.map((cfg) => {
      let options: Record<string, unknown> = {};
      if (cfg.optionsEncrypted) {
        try {
          options = decryptOptions(cfg.optionsEncrypted);
        } catch {
          options = {};
        }
      }
      return {
        identifier: cfg.identifier,
        label: cfg.label,
        is_enabled: cfg.isEnabled,
        options_masked: maskOptions(options),
      };
    });
  }

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

export function maskConfigOptions(options: Record<string, unknown>): Record<string, string> {
  return maskOptions(options);
}

function maskOptions(options: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(options)) {
    const s = typeof value === "string" ? value : String(value ?? "");
    out[key] = s.length > 4 ? `****${s.slice(-4)}` : "****";
  }
  return out;
}
