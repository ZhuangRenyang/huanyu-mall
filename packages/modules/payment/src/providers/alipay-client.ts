import { canonicalizeParams, rsaSha256Sign, rsaSha256Verify } from './signature.js';

/**
 * 支付宝 OpenAPI 客户端（RSA2 签名 + 表单请求 + 异步通知验签）。
 *
 * 不引官方 SDK 的原因：本项目只需要 4 个接口（page.pay / query / refund / close），
 * 而 SDK 会带来一批传递依赖；签名规则本身只有三条（字典序拼接、排除空值与 sign、
 * 值不编码），用已有的 `signature.ts` 就能准确实现（铁律 11：依赖集中管理）。
 *
 * 三个最容易做错的细节，这里都显式处理：
 *
 * 1. **时间戳是北京时间（UTC+8），格式 `yyyy-MM-dd HH:mm:ss`**。
 *    服务器通常跑 UTC，直接 `toISOString()` 会差 8 小时，支付宝报
 *    `Invalid timestamp`（或时间戳过期）。注意不能用 `Intl` 依赖系统时区。
 *
 * 2. **签名的原文里值不做 URL 编码**，但拼进请求时 `sign` 与 `biz_content`
 *    要按表单规则编码。顺序错了会得到「验签失败」而不是「参数错误」，很难查。
 *
 * 3. **回调验签必须排除空值参数**（见 canonicalizeParams 注释）。
 */

export class AlipayApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly subCode?: string,
    /** true 表示业务拒绝（如交易不存在、已退款），false 表示对接故障。 */
    readonly businessRejection = false,
  ) {
    super(message);
    this.name = 'AlipayApiError';
  }
}

export interface AlipayClientConfig {
  appId: string;
  /** 应用私钥（PKCS#8 或 PKCS#1 PEM），用于对请求签名。 */
  privateKeyPem: string;
  /** 支付宝公钥（PEM），用于验回调与响应。 */
  alipayPublicKeyPem: string;
  /** 网关：沙箱 https://openapi-sandbox.dl.alipaydev.com/gateway.do */
  gateway: string;
  notifyUrl?: string;
  returnUrl?: string;
}

/** 支付宝要求的北京时间戳（UTC+8，`yyyy-MM-dd HH:mm:ss`）。 */
export function alipayTimestamp(now: Date = new Date()): string {
  const beijing = new Date(now.getTime() + 8 * 3600 * 1000);
  return beijing.toISOString().slice(0, 19).replace('T', ' ');
}

const SUCCESS_CODE = '10000';

/** 这些 sub_code 属于「业务上走不通」，应返回 failed 而不是抛成对接故障。 */
const BUSINESS_SUB_CODES = new Set([
  'ACQ.TRADE_NOT_EXIST',
  'ACQ.TRADE_STATUS_ERROR',
  'ACQ.TRADE_HAS_FINISHED',
  'ACQ.TRADE_HAS_CLOSE',
  'ACQ.BUYER_BALANCE_NOT_ENOUGH',
  'ACQ.BUYER_ENABLE_STATUS_FORBID',
  'ACQ.PAYMENT_AUTH_CODE_INVALID',
  'ACQ.REFUND_AMT_NOT_EQUAL_TOTAL',
  'ACQ.SELLER_BALANCE_NOT_ENOUGH',
]);

export class AlipayClient {
  constructor(private readonly config: AlipayClientConfig) {}

  /** 公共请求参数（除 sign）。 */
  private commonParams(method: string): Record<string, string> {
    return {
      app_id: this.config.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: alipayTimestamp(),
      version: '1.0',
    };
  }

  private sign(params: Record<string, string>): string {
    return rsaSha256Sign(this.config.privateKeyPem, canonicalizeParams(params));
  }

  /**
   * 电脑/手机网站支付：拼出可直接跳转的收银台 URL。
   *
   * 用 `alipay.trade.page.pay`（PC）；移动端可换 `alipay.trade.wap.pay`，
   * 两者参数一致，只是收银台形态不同。
   */
  buildPagePayUrl(input: { outTradeNo: string; totalAmount: string; subject: string; body?: string }): string {
    const params: Record<string, string> = {
      ...this.commonParams('alipay.trade.page.pay'),
      biz_content: JSON.stringify({
        out_trade_no: input.outTradeNo,
        total_amount: input.totalAmount,
        subject: input.subject,
        ...(input.body ? { body: input.body } : {}),
        product_code: 'FAST_INSTANT_TRADE_PAY',
      }),
    };
    if (this.config.notifyUrl) params.notify_url = this.config.notifyUrl;
    if (this.config.returnUrl) params.return_url = this.config.returnUrl;

    const sign = this.sign(params);
    /*
     * 拼 query string 时必须把 `+` 换成 `%20`。
     *
     * `URLSearchParams.toString()` 按 application/x-www-form-urlencoded 规则把空格编码成 `+`，
     * 而支付宝解析 **query string** 时不做 `+`→空格转换 —— 实测结果就是
     * 「错误代码 missing-timestamp / 缺少时间戳参数」（它收到的 timestamp 是
     * `2026-11-10+08:53:22`，带字面加号，判定非法）。
     *
     * 改成 `%20` 后两种解析规则（query 的 %20 解码、form 的 + 解码）都能得到正确值，更稳。
     *
     * ⚠️ 注意这只针对**浏览器跳转的 URL**。下面的 `call()` 用 POST form body 提交，
     * 必须保持 `+`（标准 form 编码），不要一起改。
     */
    const query = new URLSearchParams({ ...params, sign }).toString().replace(/\+/g, '%20');
    return `${this.config.gateway}?${query}`;
  }

  /** 服务端接口调用（query / refund / close），返回 `<method>_response` 节点。 */
  async call<T extends { code?: string; sub_code?: string; sub_msg?: string; msg?: string }>(
    method: string,
    bizContent: Record<string, unknown>,
  ): Promise<T> {
    const params: Record<string, string> = {
      ...this.commonParams(method),
      biz_content: JSON.stringify(bizContent),
    };
    const sign = this.sign(params);

    const res = await fetch(`${this.config.gateway}?charset=utf-8`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({ ...params, sign }).toString(),
    });

    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AlipayApiError(`支付宝返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 200)}`, String(res.status));
    }

    const nodeKey = `${method.replace(/\./g, '_')}_response`;
    const node = json[nodeKey] as T | undefined;
    if (!node) {
      throw new AlipayApiError(`支付宝响应缺少 ${nodeKey}（HTTP ${res.status}）`, String(res.status));
    }

    if (node.code !== SUCCESS_CODE) {
      const sub = node.sub_code ?? '';
      const msg = node.sub_msg ?? node.msg ?? '未知错误';
      throw new AlipayApiError(
        `支付宝接口返回 ${node.code}${sub ? `/${sub}` : ''}：${msg}`,
        node.code ?? '',
        sub || undefined,
        BUSINESS_SUB_CODES.has(sub),
      );
    }
    return node;
  }

  /**
   * 异步通知验签。
   *
   * 传入的 params 必须是**已 URL 解码**的表单参数（我们注册的 form parser 已用
   * URLSearchParams 解码，直接可用）。验签原文排除 sign/sign_type 与空值参数。
   */
  verifyNotify(params: Record<string, string>): boolean {
    const sign = params.sign;
    if (!sign) return false;
    return rsaSha256Verify(this.config.alipayPublicKeyPem, canonicalizeParams(params), sign);
  }
}
