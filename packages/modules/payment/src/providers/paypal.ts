import { fromMinor, toMinor } from '@mall/core';
import { AbstractPaymentProvider } from './abstract.js';
import { PaypalApiError, PaypalClient, type PaypalClientConfig } from './paypal-client.js';
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  WebhookActionResult,
  WebhookPayload,
} from './types.js';

/** PayPal Orders v2 的关键响应字段（只声明用到的）。 */
interface PaypalOrder {
  id: string;
  status?: string;
  links?: { rel?: string; href?: string }[];
  purchase_units?: {
    custom_id?: string;
    payments?: {
      captures?: { id: string; status?: string; amount?: { value?: string; currency_code?: string } }[];
      authorizations?: { id: string; status?: string }[];
    };
  }[];
}

interface PaypalRefund {
  id: string;
  status?: string;
}

/**
 * PayPal 支付（Orders v2 + Payments v2）。
 *
 * **金额单位与 Stripe 相反，这是本文件最容易被改错的地方**：
 * - Stripe 的 `amount` 是**整数、币种最小单位**（内部 amountMinor 可直接传）
 * - PayPal 的 `amount.value` 是**字符串、主单位**（"206.00"），必须用 `fromMinor()` 换算
 * 回调用 `toMinor()`。两边都走 `@mall/core/money`，不自己写除以 100 —— 因为
 * zero-decimal 币种（JPY/KRW）的小数位是 0，硬除 100 会让 ¥20600 变成 ¥206.00。
 *
 * 配置项（缺任一必需项时**抛明确错误**，不静默降级）：
 *   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_MODE(sandbox|live) / PAYPAL_WEBHOOK_ID
 */
export class PaypalPaymentProvider extends AbstractPaymentProvider {
  private clientInstance: PaypalClient | null = null;

  /** 构造函数保持不触网（ADR-008），客户端在首次调用时才创建。 */
  private client(): PaypalClient {
    if (this.clientInstance) return this.clientInstance;
    const cfg = this.readConfig();
    this.clientInstance = new PaypalClient(cfg);
    return this.clientInstance;
  }

  private readConfig(): PaypalClientConfig {
    const clientId = String(this.config.clientId ?? '').trim();
    const clientSecret = String(this.config.clientSecret ?? '').trim();
    const webhookId = String(this.config.webhookId ?? '').trim();
    const mode = String(this.config.mode ?? 'sandbox') === 'live' ? 'live' : 'sandbox';

    if (!clientId || !clientSecret) {
      throw new Error(
        'PayPal 未配置：请在管理后台「支付方式」填写 Client ID 与 Secret（sandbox 环境即可联调，无需真实商户号）',
      );
    }
    return { clientId, clientSecret, mode, webhookId };
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const captureMethod = String(this.config.captureMethod ?? 'automatic');
    const intent = captureMethod === 'manual' ? 'AUTHORIZE' : 'CAPTURE';

    const order = await this.client().request<PaypalOrder>('/v2/checkout/orders', {
      method: 'POST',
      /* 用 sessionId 派生幂等键：用户重复点"去支付"不会生成多个订单 */
      idempotencyKey: `init_${input.sessionId}`,
      body: {
        intent,
        purchase_units: [
          {
            custom_id: input.sessionId,
            amount: {
              currency_code: input.currencyCode,
              value: fromMinor(input.amountMinor, input.currencyCode),
            },
          },
        ],
        application_context: {
          user_action: 'PAY_NOW',
          ...(input.returnUrl ? { return_url: input.returnUrl, cancel_url: input.returnUrl } : {}),
        },
      },
    });

    /* 新版返回 rel=payer-action，旧版是 approve —— 两个都认，避免版本差异导致拿不到跳转链接 */
    const link = order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    if (!link?.href) {
      throw new Error(`PayPal 未返回可用的跳转链接（order=${order.id}, status=${order.status ?? '未知'}）`);
    }

    return {
      kind: 'redirectUrl',
      redirectUrl: link.href,
      providerReference: order.id,
      raw: { orderId: order.id, status: order.status, intent },
    };
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const ref = input.providerReference ?? input.sessionId;
    const order = await this.client().request<PaypalOrder>(`/v2/checkout/orders/${ref}`);

    /* PayPal 订单状态：CREATED / SAVED / APPROVED / VOIDED / COMPLETED / PAYER_ACTION_REQUIRED */
    switch (order.status) {
      case 'COMPLETED':
        /* 自动捕获模式下点完支付即完成 */
        return { status: 'authorized', providerReference: ref, raw: { paypalStatus: order.status } };
      case 'APPROVED':
        /* 用户已批准，等待服务端 capture */
        return { status: 'authorized', providerReference: ref, raw: { paypalStatus: order.status } };
      case 'VOIDED':
        return { status: 'failed', providerReference: ref, raw: { paypalStatus: order.status } };
      default:
        /* CREATED / SAVED / PAYER_ACTION_REQUIRED：用户还没在 PayPal 侧完成动作 */
        return { status: 'requires_more', providerReference: ref, raw: { paypalStatus: order.status } };
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const ref = input.providerReference ?? input.paymentId;
    try {
      const order = await this.client().request<PaypalOrder>(`/v2/checkout/orders/${ref}/capture`, {
        method: 'POST',
        /* 原样透传幂等键：重复捕获不会重复扣款 */
        idempotencyKey: input.idempotencyKey,
        body: {},
      });
      const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
      return {
        status: 'captured',
        providerReference: capture?.id ?? ref,
        raw: { orderId: order.id, captureId: capture?.id, paypalStatus: order.status },
      };
    } catch (err) {
      /* 已捕获 → 幂等成功，不要报错（重试场景很常见） */
      if (err instanceof PaypalApiError && err.issues.includes('ORDER_ALREADY_CAPTURED')) {
        return { status: 'captured', providerReference: ref, raw: { idempotent: true } };
      }
      if (err instanceof PaypalApiError && err.businessRejection) {
        return {
          status: 'failed',
          providerReference: ref,
          raw: { issues: err.issues, httpStatus: err.status, debugId: err.debugId },
        };
      }
      throw err;
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    /* PayPal 的退款对象是 capture，不是 order —— providerReference 必须是 captureId */
    const captureId = input.providerReference ?? input.paymentId;
    try {
      const refund = await this.client().request<PaypalRefund>(`/v2/payments/captures/${captureId}/refund`, {
        method: 'POST',
        idempotencyKey: input.idempotencyKey,
        body: {
          amount: {
            currency_code: input.currencyCode,
            value: fromMinor(input.amountMinor, input.currencyCode),
          },
          ...(input.reason ? { note_to_payer: input.reason.slice(0, 255) } : {}),
        },
      });
      return {
        status: refund.status === 'COMPLETED' || refund.status === 'PENDING' ? 'succeeded' : 'failed',
        providerReference: refund.id,
        raw: { captureId, refundStatus: refund.status },
      };
    } catch (err) {
      if (err instanceof PaypalApiError && err.businessRejection) {
        return {
          status: 'failed',
          providerReference: captureId,
          raw: { issues: err.issues, httpStatus: err.status, debugId: err.debugId },
        };
      }
      throw err;
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const ref = input.providerReference ?? input.paymentId;
    try {
      /*
       * PayPal Orders v2 没有"取消订单"端点。能做的是 void 授权：
       * 已授权未捕获的，void 后额度释放；未授权的订单 PayPal 侧会自然过期（约 3 小时）。
       * 已捕获的不能 void，必须走退款 —— 那种情况返回 failed，由上层引导退款。
       */
      const order = await this.client().request<PaypalOrder>(`/v2/checkout/orders/${ref}`);
      const authId = order.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
      if (!authId) {
        /* 未授权：本地标记取消即可，PayPal 侧无副作用 */
        return { status: 'canceled' };
      }
      await this.client().request<void>(`/v2/payments/authorizations/${authId}/void`, { method: 'POST' });
      return { status: 'canceled' };
    } catch (err) {
      if (err instanceof PaypalApiError && err.businessRejection) return { status: 'failed' };
      throw err;
    }
  }

  async getWebhookActionAndData(payload: WebhookPayload): Promise<WebhookActionResult> {
    /* 先验签（失败抛 WebhookSignatureError，由 service 转 401 且不落库），再解析 */
    await this.client().verifyWebhook(payload.headers, payload.rawBody);

    const body = JSON.parse(payload.rawBody) as {
      id: string;
      event_type: string;
      resource?: {
        id?: string;
        custom_id?: string;
        status?: string;
        amount?: { value?: string; currency_code?: string };
        supplementary_data?: { related_ids?: { order_id?: string } };
      };
    };

    const res = body.resource ?? {};
    const currency = res.amount?.currency_code ?? '';
    let amountMinor: bigint | undefined;
    if (res.amount?.value) {
      try {
        amountMinor = toMinor(res.amount.value, currency);
      } catch {
        /* 币种不在指数表里时不要让整条回调失败，金额留空由上层按支付单金额兜底 */
        amountMinor = undefined;
      }
    }

    const action =
      body.event_type === 'PAYMENT.CAPTURE.COMPLETED'
        ? 'captured'
        : body.event_type === 'PAYMENT.CAPTURE.DENIED'
          ? 'failed'
          : /* 退款/授权等其他事件不改变支付单的 captured/failed 语义，标记 not_supported
               由上层按需处理（退款通常是我们主动发起，状态已同步更新） */
            'not_supported';

    return {
      eventId: body.id,
      action,
      data: {
        paymentId: res.id,
        sessionId: res.custom_id ?? res.supplementary_data?.related_ids?.order_id,
        reference: res.id,
        amountMinor,
        reason: res.status,
      },
    };
  }

  /** 探活：能换到 token 就说明凭据与网络都通。失败返回 false，不抛。 */
  override async healthCheck(): Promise<boolean> {
    try {
      await this.client().accessToken();
      return true;
    } catch {
      return false;
    }
  }
}
