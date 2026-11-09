import { WebhookSignatureError } from '../errors.js';

/**
 * PayPal REST 客户端（OAuth2 + 请求封装 + 错误映射）。
 *
 * 三个设计要点：
 *
 * 1. **token 走模块级缓存，不是实例级**。`ProviderRegistry.load()` 每次调用都
 *    `new` 一个 Provider 实例（见 registry.ts:74-78），实例级缓存会立刻失效，
 *    等于每笔支付都重新换一次 token。PayPal 的 access_token 有效期 32400 秒，
 *    按 clientId 缓存在模块作用域里跨实例复用，并在到期前 60 秒主动刷新。
 *
 * 2. **不引 HTTP 库**。Node 18+ 的全局 `fetch` 足够；引 axios/undici 只会多一个
 *    需要跟版本走的依赖（铁律 11 要求依赖集中管理）。
 *
 * 3. **错误分层**：PayPal 的错误必须先分清「业务拒绝」还是「对接故障」。
 *    卡被拒（INSTRUMENT_DECLINED 等）是正常业务结果，应由 Provider 返回 failed；
 *    凭据错 / 参数错 / 5xx 是对接故障，必须抛出去让运维看得见 —— 把后者也
 *    咽成 failed，会让"密钥填错了"表现为"用户付款失败"，排查成本极高。
 */

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE = 'https://api-m.paypal.com';

/** token 到期前提前刷新的余量（毫秒）。 */
const REFRESH_MARGIN_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** 按 clientId 缓存（同一账号多实例共享）。 */
const tokenCache = new Map<string, CachedToken>();

/** PayPal 返回的错误体结构（只声明用到的字段）。 */
interface PaypalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string }[];
}

/**
 * PayPal 明确表示「这笔支付走不通」的 issue，属业务结果而非对接故障。
 * 命中这些时 Provider 返回 failed；其余一律抛出。
 */
const BUSINESS_ISSUES = new Set([
  'INSTRUMENT_DECLINED',
  'PAYER_ACTION_REQUIRED',
  'ORDER_ALREADY_CAPTURED',
  'ORDER_NOT_APPROVED',
  'ORDER_EXPIRED',
  'TRANSACTION_REFUSED',
  'PAYEE_ACCOUNT_RESTRICTED',
  'COMPLIANCE_VIOLATION',
]);

export class PaypalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: PaypalErrorBody | null,
    /** true 表示「业务拒绝」（可映射为 failed），false 表示「对接故障」（必须抛）。 */
    readonly businessRejection: boolean,
  ) {
    super(message);
    this.name = 'PaypalApiError';
  }

  get debugId(): string | undefined {
    return this.body?.debug_id;
  }

  get issues(): string[] {
    return (this.body?.details ?? []).map((d) => d.issue ?? '').filter(Boolean);
  }
}

export interface PaypalClientConfig {
  clientId: string;
  clientSecret: string;
  mode: 'sandbox' | 'live';
  webhookId: string;
}

export class PaypalClient {
  constructor(private readonly config: PaypalClientConfig) {}

  get baseUrl(): string {
    return this.config.mode === 'live' ? LIVE_BASE : SANDBOX_BASE;
  }

  /** OAuth2 client_credentials；命中缓存直接返回。 */
  async accessToken(): Promise<string> {
    const key = `${this.config.mode}:${this.config.clientId}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return cached.token;
    }

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const text = await res.text();
    if (!res.ok) {
      throw new PaypalApiError(
        `PayPal 凭据无效或已撤销（换取 access_token 失败，HTTP ${res.status}）。请检查 PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET 与 PAYPAL_MODE 是否匹配`,
        res.status,
        safeJson(text),
        false,
      );
    }

    const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new PaypalApiError('PayPal 未返回 access_token', res.status, null, false);
    }

    tokenCache.set(key, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  }

  /** 带 Bearer 的 JSON 请求；非 2xx 统一转成 PaypalApiError 并判定是否业务拒绝。 */
  async request<T>(
    path: string,
    init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (init.idempotencyKey) headers['PayPal-Request-Id'] = init.idempotencyKey;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    if (res.ok) {
      return (text ? JSON.parse(text) : undefined) as T;
    }

    const body = safeJson(text);
    const issues = (body?.details ?? []).map((d) => d.issue ?? '');
    const businessRejection = issues.length > 0 && issues.every((i) => BUSINESS_ISSUES.has(i));
    const detail = issues.length > 0 ? `（${issues.join(', ')}）` : '';
    throw new PaypalApiError(
      `PayPal 接口返回 HTTP ${res.status}${detail}${body?.debug_id ? `，debug_id=${body.debug_id}` : ''}`,
      res.status,
      body,
      businessRejection,
    );
  }

  /**
   * Webhook 验签：调 PayPal 官方 verify-webhook-signature。
   *
   * 不用本地 RSA 验签（旧实现配 `publicKeyPem` 那种）的原因：PayPal 的签名证书
   * 会轮换，本地得自己拉 `/v1/notifications/certs` 并做缓存与失效处理，
   * 一旦证书换了而本地没跟上，回调会被全量判失败。官方这个 API 替你处理了轮换。
   * 代价是每次回调多一次网络往返 —— 对支付回调这种低频、且能重试的场景可接受。
   */
  async verifyWebhook(headers: Record<string, string>, rawBody: string): Promise<void> {
    const webhookId = this.config.webhookId;
    if (!webhookId) {
      throw new WebhookSignatureError('PAYPAL_WEBHOOK_ID 未配置，无法验签');
    }

    const payload = {
      auth_algo: headers['paypal-auth-algo'] ?? '',
      cert_url: headers['paypal-cert-url'] ?? '',
      transmission_id: headers['paypal-transmission-id'] ?? '',
      transmission_sig: headers['paypal-transmission-sig'] ?? '',
      transmission_time: headers['paypal-transmission-time'] ?? '',
      webhook_id: webhookId,
      webhook_event: safeJson(rawBody) ?? {},
    };

    let result: { verification_status?: string };
    try {
      result = await this.request<{ verification_status?: string }>(
        '/v1/notifications/verify-webhook-signature',
        { method: 'POST', body: payload },
      );
    } catch (err) {
      /* 验签接口本身故障时，不能放行（宁可让 PayPal 重试，也不能接受未验签的回调） */
      throw new WebhookSignatureError(
        `PayPal 验签接口调用失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (result?.verification_status !== 'SUCCESS') {
      throw new WebhookSignatureError(
        `PayPal webhook 验签未通过（verification_status=${result?.verification_status ?? '未知'}）`,
      );
    }
  }
}

/** 仅用于测试注入：清空 token 缓存，避免用例之间互相影响。 */
export function __clearPaypalTokenCache(): void {
  tokenCache.clear();
}

function safeJson(text: string): PaypalErrorBody | null {
  try {
    return JSON.parse(text) as PaypalErrorBody;
  } catch {
    return null;
  }
}
