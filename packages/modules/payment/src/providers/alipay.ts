import { createPrivateKey } from 'node:crypto';

import { fromMinor, toMinor } from '@mall/core';
import { AbstractPaymentProvider } from './abstract.js';
import { AlipayApiError, AlipayClient, type AlipayClientConfig } from './alipay-client.js';
import { WebhookSignatureError } from '../errors.js';
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

const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const LIVE_GATEWAY = 'https://openapi.alipay.com/gateway.do';

/** `alipay.trade.query` / `refund` / `close` 的响应节点（只声明用到的字段）。 */
interface AlipayTradeNode {
  code?: string;
  sub_code?: string;
  sub_msg?: string;
  trade_no?: string;
  out_trade_no?: string;
  trade_status?: string;
  total_amount?: string;
  refund_fee?: string;
}

/**
 * 支付宝（电脑/手机网站支付，即时到账）。
 *
 * 与 Stripe/PayPal 的模型差异，是本文件最重要的背景：
 * - **没有 authorize → capture 两阶段**：用户付完钱就到账（`TRADE_SUCCESS`）。
 *   所以 `authorizePayment` 只能「查单确认」，`capturePayment` 也是查单确认后直接判 captured，
 *   不存在「服务端再扣一次」的动作。
 * - **回调是 form-encoded 而不是 JSON**：`rawBody` 是 `k=v&k=v`，必须用 URLSearchParams 解析。
 *   （原实现用 JSON.parse，导致真实回调根本解析不出来。）
 * - **金额是字符串主单位**（"206.00"），与 PayPal 一致、与 Stripe 相反，统一走 fromMinor/toMinor。
 *
 * 配置项：ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY /
 *         ALIPAY_GATEWAY / ALIPAY_NOTIFY_URL(可选)
 */
export class AlipayPaymentProvider extends AbstractPaymentProvider {
  private clientInstance: AlipayClient | null = null;

  /** 构造函数保持不触网（ADR-008）。 */
  private client(): AlipayClient {
    if (this.clientInstance) return this.clientInstance;
    this.clientInstance = new AlipayClient(this.readConfig());
    return this.clientInstance;
  }

  private readConfig(): AlipayClientConfig {
    const appId = String(this.config.appId ?? '').trim();
    const privateKeyPem = normalizePem(String(this.config.privateKey ?? ''), 'PRIVATE');
    const alipayPublicKeyPem = normalizePem(String(this.config.alipayPublicKey ?? ''), 'PUBLIC');
    const mode = String(this.config.mode ?? 'sandbox') === 'live' ? 'live' : 'sandbox';
    const gateway = String(this.config.gateway ?? '').trim() || (mode === 'live' ? LIVE_GATEWAY : SANDBOX_GATEWAY);
    const notifyUrl = String(this.config.notifyUrl ?? '').trim() || undefined;
    const returnUrl = String(this.config.returnUrl ?? '').trim() || undefined;

    if (!appId || !privateKeyPem || !alipayPublicKeyPem) {
      throw new Error(
        '支付宝未配置：请在管理后台「支付方式」填写 APPID、应用私钥、支付宝公钥（沙箱控制台可直接获取，无需真实商户号）',
      );
    }
    return { appId, privateKeyPem, alipayPublicKeyPem, gateway, notifyUrl, returnUrl };
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const totalAmount = fromMinor(input.amountMinor, input.currencyCode);
    const subject = String(input.metadata?.subject ?? `订单 ${input.sessionId}`);

    /*
     * 支付形态由配置决定（ALIPAY_FLOW）：
     * - `qr`（默认）：当面付 `alipay.trade.precreate` → 返回二维码。
     *   支付宝**沙箱只支持这一条**（`page.pay` 网关直接 404），而且当面付也是
     *   国内主流形态，生产环境同样适用。
     * - `redirect`：跳转收银台。**按设备自动分流** ——
     *   - 手机端 → `alipay.trade.wap.pay`（手机网站支付，唤起支付宝 App）
     *   - PC 端 → `alipay.trade.page.pay`（电脑网站支付）
     *   page.pay 沙箱 404，但 **wap.pay 沙箱是支持的**，所以跳转链路在沙箱也能联调。
     * - `wap`：强制手机网站支付（wap.pay），不分设备。适合纯移动场景。
     *
     * 设备判定来自前端在 createPaymentSession 时传的 metadata.device，
     * 缺省按 PC（page.pay）处理。
     *
     * 各路径都传 out_trade_no = 商户单号（= collection.id），支付宝原样回传，
     * 回调据此定位支付单（见 payment.service 的 resolvePaymentForWebhook）。
     */
    const flow = this.resolveFlow(input);

    if (flow === 'qr') {
      const { qrCode, tradeNo } = await this.client().createQrcode({
        outTradeNo: input.sessionId,
        totalAmount,
        subject,
      });
      return {
        kind: 'qrcode',
        qrcode: qrCode,
        providerReference: input.sessionId,
        raw: { outTradeNo: input.sessionId, tradeNo, flow },
      };
    }

    const isMobile = flow === 'wap' || String(input.metadata?.device ?? '') === 'mobile';
    const url = isMobile
      ? this.client().buildWapPayUrl({ outTradeNo: input.sessionId, totalAmount, subject })
      : this.client().buildPagePayUrl({ outTradeNo: input.sessionId, totalAmount, subject });
    return {
      kind: 'redirectUrl',
      redirectUrl: url,
      providerReference: input.sessionId,
      raw: { outTradeNo: input.sessionId, flow, method: isMobile ? 'wap.pay' : 'page.pay' },
    };
  }

  /** 解析支付形态：qr / redirect / wap。非法值退回默认 qr。 */
  private resolveFlow(input: InitiatePaymentInput): 'qr' | 'redirect' | 'wap' {
    const cfg = String(this.config.flow ?? 'qr').trim();
    if (cfg === 'redirect' || cfg === 'wap') return cfg;
    return 'qr';
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const outTradeNo = input.providerReference ?? input.sessionId;
    try {
      const node = await this.client().call<AlipayTradeNode>('alipay.trade.query', { out_trade_no: outTradeNo });
      switch (node.trade_status) {
        case 'TRADE_SUCCESS':
        case 'TRADE_FINISHED':
          return { status: 'authorized', providerReference: node.trade_no ?? outTradeNo, raw: { tradeStatus: node.trade_status } };
        case 'WAIT_BUYER_PAY':
          return { status: 'requires_more', providerReference: outTradeNo, raw: { tradeStatus: node.trade_status } };
        case 'TRADE_CLOSED':
          return { status: 'failed', providerReference: outTradeNo, raw: { tradeStatus: node.trade_status } };
        default:
          return { status: 'requires_more', providerReference: outTradeNo, raw: { tradeStatus: node.trade_status } };
      }
    } catch (err) {
      /* 交易不存在 = 用户还没在收银台付款，属正常中间态，不当故障抛 */
      if (err instanceof AlipayApiError && err.subCode === 'ACQ.TRADE_NOT_EXIST') {
        return { status: 'requires_more', providerReference: outTradeNo, raw: { pending: true } };
      }
      throw err;
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    /*
     * 支付宝即时到账没有服务端「捕获」动作：钱在用户付款时就已到账。
     * 这里只做一次查单确认，把「确认成功」映射为 captured，保证接口语义与
     * Stripe/PayPal 一致（上层 workflow 不感知渠道差异）。
     */
    const outTradeNo = input.providerReference ?? input.paymentId;
    try {
      const node = await this.client().call<AlipayTradeNode>('alipay.trade.query', { out_trade_no: outTradeNo });
      const ok = node.trade_status === 'TRADE_SUCCESS' || node.trade_status === 'TRADE_FINISHED';
      return {
        status: ok ? 'captured' : 'failed',
        providerReference: node.trade_no ?? outTradeNo,
        raw: { tradeStatus: node.trade_status },
      };
    } catch (err) {
      if (err instanceof AlipayApiError && err.businessRejection) {
        return { status: 'failed', providerReference: outTradeNo, raw: { subCode: err.subCode } };
      }
      throw err;
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const outTradeNo = input.providerReference ?? input.paymentId;
    try {
      const node = await this.client().call<AlipayTradeNode>('alipay.trade.refund', {
        out_trade_no: outTradeNo,
        refund_amount: fromMinor(input.amountMinor, input.currencyCode),
        /* 支付宝用 out_request_no 做退款幂等：同一个号重复提交不会重复退 */
        out_request_no: input.idempotencyKey,
        ...(input.reason ? { refund_reason: input.reason.slice(0, 256) } : {}),
      });
      return {
        status: 'succeeded',
        providerReference: node.trade_no ?? outTradeNo,
        raw: { refundFee: node.refund_fee, tradeStatus: node.trade_status },
      };
    } catch (err) {
      if (err instanceof AlipayApiError && err.businessRejection) {
        return { status: 'failed', providerReference: outTradeNo, raw: { subCode: err.subCode } };
      }
      throw err;
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const outTradeNo = input.providerReference ?? input.paymentId;
    try {
      /* alipay.trade.close 只能关闭「未付款」的订单；已付款的必须走退款 */
      await this.client().call<AlipayTradeNode>('alipay.trade.close', { out_trade_no: outTradeNo });
      return { status: 'canceled' };
    } catch (err) {
      if (err instanceof AlipayApiError && err.businessRejection) return { status: 'failed' };
      throw err;
    }
  }

  async getWebhookActionAndData(payload: WebhookPayload): Promise<WebhookActionResult> {
    /*
     * 支付宝异步通知是 application/x-www-form-urlencoded。
     * rawBody 形如 `gmt_create=...&charset=utf-8&...&sign=xxx&sign_type=RSA2`。
     * 必须用 URLSearchParams 解析（原实现用 JSON.parse，真实回调解析不出来）。
     */
    const params = Object.fromEntries(new URLSearchParams(payload.rawBody)) as Record<string, string>;

    if (!this.client().verifyNotify(params)) {
      throw new WebhookSignatureError('alipay notify signature invalid');
    }

    const tradeStatus = params.trade_status ?? '';
    const action =
      tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
        ? 'captured'
        : tradeStatus === 'TRADE_CLOSED'
          ? 'canceled'
          : /* WAIT_BUYER_PAY 等：用户还没付完，不改变支付单状态 */
            'not_supported';

    let amountMinor: bigint | undefined;
    if (params.total_amount) {
      try {
        amountMinor = toMinor(params.total_amount, 'CNY');
      } catch {
        amountMinor = undefined;
      }
    }

    return {
      /* 支付宝回调没有事件 id，用 trade_no + 状态拼一个稳定标识做幂等键 */
      eventId: `${params.trade_no ?? params.out_trade_no ?? 'unknown'}:${tradeStatus}`,
      action,
      data: {
        sessionId: params.out_trade_no,
        paymentId: params.out_trade_no,
        reference: params.trade_no,
        amountMinor,
        reason: tradeStatus,
      },
    };
  }

  /** 探活：配置齐全即视为可用（不主动打支付宝接口，避免影响下单时延）。 */
  override async healthCheck(): Promise<boolean> {
    try {
      this.readConfig();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 把配置里的密钥规范成 PEM。
 *
 * 用户在后台粘贴密钥时常见三种形态：
 * 1. 完整 PEM（带 BEGIN/END）—— 原样使用
 * 2. 只有 base64 主体
 * 3. 只有 base64 主体，且换行被写成了字面量 `\n`
 *
 * 第 2/3 种要自己补 PEM 头，但**私钥的头不能猜**：
 * - PKCS#8（PrivateKeyInfo）→ `BEGIN PRIVATE KEY`，base64 通常以 MIIEv 开头
 * - PKCS#1（RSAPrivateKey）→ `BEGIN RSA PRIVATE KEY`，base64 通常以 MIIEo/MIIEp 开头
 * 支付宝密钥工具给的「非 Java 适用」是 PKCS#8，「Java 适用」是 PKCS#1，
 * 用户经常把 PKCS#1 主体粘进来。包错头时 node 会报
 * `DECODER routines::unsupported`（甚至误判成 EncryptedPrivateKeyInfo），
 * 现象是「密钥明明填了却签名失败」，极难排查。
 *
 * 所以这里不按前缀猜，而是**两种头都试，用 createPrivateKey 验证哪个真能解析**。
 */
function normalizePem(raw: string, kind: 'PRIVATE' | 'PUBLIC'): string {
  const text = raw.replace(/\\n/g, '\n').trim();
  if (!text) return '';
  if (text.includes('-----BEGIN')) return text;

  const body = text.replace(/\s+/g, '');
  if (kind === 'PUBLIC') return wrapPem(body, 'PUBLIC KEY');

  for (const label of ['PRIVATE KEY', 'RSA PRIVATE KEY'] as const) {
    const pem = wrapPem(body, label);
    try {
      createPrivateKey(pem);
      return pem;
    } catch {
      /* 换下一个头再试 */
    }
  }
  /* 两种都不行：返回 PKCS#8 形态，让上层在真正使用时抛出可定位的错误 */
  return wrapPem(body, 'PRIVATE KEY');
}

function wrapPem(body: string, label: string): string {
  const chunks = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN ${label}-----\n${chunks.join('\n')}\n-----END ${label}-----`;
}
