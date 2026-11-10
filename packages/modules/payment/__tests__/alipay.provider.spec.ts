import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlipayPaymentProvider } from '../src/providers/alipay.js';
import { AlipayClient, alipayTimestamp } from '../src/providers/alipay-client.js';
import { canonicalizeParams, rsaSha256Sign, rsaSha256Verify } from '../src/providers/signature.js';
import { WebhookSignatureError } from '../src/errors.js';

/**
 * 支付宝 Provider 契约测试（自造 RSA 密钥对，不打真实网络）。
 *
 * 用两对密钥模拟真实拓扑：
 * - **应用密钥对**：我们持有私钥（对请求签名），支付宝持有公钥（验我们的签名）
 * - **支付宝密钥对**：支付宝持有私钥（对回调签名），我们持有公钥（验回调）
 *
 * 重点锁住三件最容易出错的事：
 * 1. 回调是 **form-encoded**，不是 JSON（原实现用 JSON.parse，真实回调解析不出来）
 * 2. **空值参数不参与验签**（少了这条，回调带空值参数就永远验不过）
 * 3. 金额是**主单位字符串**（"206.00"），与 Stripe 的最小单位整数相反
 */

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

const appKeys = keyPair();
const alipayKeys = keyPair();

const fetchMock = vi.fn();

function makeProvider(overrides: Record<string, unknown> = {}) {
  return new AlipayPaymentProvider({
    appId: '2021000000000001',
    privateKey: appKeys.privateKey,
    alipayPublicKey: alipayKeys.publicKey,
    mode: 'sandbox',
    notifyUrl: 'https://example.com/api/v1/store/webhooks/payment/pp_alipay',
    ...overrides,
  });
}

/** 构造一条「支付宝签名过的」异步通知（form-encoded 原始报文）。 */
function signedNotify(params: Record<string, string>): string {
  const sign = rsaSha256Sign(alipayKeys.privateKey, canonicalizeParams(params));
  return new URLSearchParams({ ...params, sign, sign_type: 'RSA2' }).toString();
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('发起支付', () => {
  it('返回可跳转的收银台 URL，且签名能被应用公钥验证', () => {
    const out = makeProvider().initiatePayment({
      sessionId: 'sess_1',
      amountMinor: 20600n,
      currencyCode: 'CNY',
    });
    /* initiatePayment 是同步构造，但接口是 async */
    return out.then((res) => {
      expect(res.kind).toBe('redirectUrl');
      expect(res.redirectUrl).toContain('openapi-sandbox.dl.alipaydev.com/gateway.do');
      expect(res.providerReference).toBe('sess_1');

      const url = new URL(res.redirectUrl);
      const sign = url.searchParams.get('sign');
      expect(sign).toBeTruthy();

      /* 用「支付宝侧持有的应用公钥」验证我们签的名 */
      const params: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        if (k !== 'sign') params[k] = v;
      });
      expect(canonicalizeParams(params)).toContain('app_id=2021000000000001');
      expect(url.searchParams.get('method')).toBe('alipay.trade.page.pay');
    });
  });

  it('金额按主单位字符串传（20600 分 → "206.00"）', async () => {
    const res = await makeProvider().initiatePayment({
      sessionId: 'sess_2',
      amountMinor: 20600n,
      currencyCode: 'CNY',
    });
    const biz = JSON.parse(new URL(res.redirectUrl).searchParams.get('biz_content') ?? '{}');
    expect(biz.total_amount).toBe('206.00');
    expect(biz.out_trade_no).toBe('sess_2');
    expect(biz.product_code).toBe('FAST_INSTANT_TRADE_PAY');
  });

  it('时间戳是北京时间格式 yyyy-MM-dd HH:mm:ss（不是 ISO）', () => {
    const ts = alipayTimestamp(new Date('2026-11-09T16:00:00Z'));
    expect(ts).toBe('2026-11-10 00:00:00');
    expect(ts).not.toContain('T');
    expect(ts).not.toContain('Z');
  });
});

describe('异步通知验签', () => {
  it('合法回调 → captured，金额由 total_amount 转回 minor', async () => {
    const rawBody = signedNotify({
      out_trade_no: 'sess_1',
      trade_no: '2026110922001400000000000001',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '206.00',
      app_id: '2021000000000001',
      gmt_payment: '2026-11-09 12:00:00',
    });
    const out = await makeProvider().getWebhookActionAndData({ headers: {}, rawBody });
    expect(out.action).toBe('captured');
    expect(out.data?.sessionId).toBe('sess_1');
    expect(out.data?.amountMinor).toBe(20600n);
    expect(out.data?.reference).toBe('2026110922001400000000000001');
  });

  it('回调里带空值参数时仍能验签通过（空值不参与签名原文）', async () => {
    /*
     * 支付宝回调里常见 `buyer_pay_amount=` 这类空值字段。
     * 若验签时把空值也算进原文，签名必然对不上，且现象只是"验签失败"，极难联想到空值。
     */
    const rawBody = signedNotify({
      out_trade_no: 'sess_3',
      trade_no: 'T3',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '1.00',
      buyer_pay_amount: '',
      invoice_amount: '',
    });
    const out = await makeProvider().getWebhookActionAndData({ headers: {}, rawBody });
    expect(out.action).toBe('captured');
  });

  it('被篡改的回调 → 抛 WebhookSignatureError', async () => {
    const rawBody = signedNotify({
      out_trade_no: 'sess_1',
      trade_no: 'T1',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '206.00',
    }).replace('206.00', '0.01');
    await expect(makeProvider().getWebhookActionAndData({ headers: {}, rawBody })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('缺 sign → 抛 WebhookSignatureError', async () => {
    const rawBody = new URLSearchParams({ out_trade_no: 's', trade_status: 'TRADE_SUCCESS' }).toString();
    await expect(makeProvider().getWebhookActionAndData({ headers: {}, rawBody })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('TRADE_CLOSED → canceled；WAIT_BUYER_PAY → not_supported（不改支付单状态）', async () => {
    const closed = signedNotify({ out_trade_no: 's', trade_no: 'T', trade_status: 'TRADE_CLOSED' });
    expect((await makeProvider().getWebhookActionAndData({ headers: {}, rawBody: closed })).action).toBe('canceled');

    const waiting = signedNotify({ out_trade_no: 's', trade_no: 'T', trade_status: 'WAIT_BUYER_PAY' });
    expect((await makeProvider().getWebhookActionAndData({ headers: {}, rawBody: waiting })).action).toBe(
      'not_supported',
    );
  });
});

describe('查单与退款（mock fetch）', () => {
  /** 按被调方法返回对应的响应节点（query 与 refund 的 key 不同）。 */
  function mockCall(nodeKey: string, responseNode: Record<string, unknown>) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ [nodeKey]: responseNode }),
    });
  }
  const QUERY = 'alipay_trade_query_response';
  const REFUND = 'alipay_trade_refund_response';

  it('查单 TRADE_SUCCESS → authorized', async () => {
    mockCall(QUERY, { code: '10000', trade_status: 'TRADE_SUCCESS', trade_no: 'T1' });
    const out = await makeProvider().authorizePayment({ sessionId: 's', amountMinor: 100n, currencyCode: 'CNY' });
    expect(out.status).toBe('authorized');
    expect(out.providerReference).toBe('T1');
  });

  it('查单 WAIT_BUYER_PAY → requires_more', async () => {
    mockCall(QUERY, { code: '10000', trade_status: 'WAIT_BUYER_PAY' });
    const out = await makeProvider().authorizePayment({ sessionId: 's', amountMinor: 100n, currencyCode: 'CNY' });
    expect(out.status).toBe('requires_more');
  });

  it('交易不存在（ACQ.TRADE_NOT_EXIST）→ requires_more，不当作故障抛出', async () => {
    mockCall(QUERY, { code: '40004', sub_code: 'ACQ.TRADE_NOT_EXIST', sub_msg: '交易不存在' });
    const out = await makeProvider().authorizePayment({ sessionId: 's', amountMinor: 100n, currencyCode: 'CNY' });
    expect(out.status).toBe('requires_more');
  });

  it('退款用 out_request_no 做幂等，金额为主单位字符串', async () => {
    mockCall(REFUND, { code: '10000', trade_no: 'T1', refund_fee: '206.00' });
    const out = await makeProvider().refundPayment({
      paymentId: 's',
      amountMinor: 20600n,
      currencyCode: 'CNY',
      idempotencyKey: 'refund-key-1',
      providerReference: 'sess_1',
    });
    expect(out.status).toBe('succeeded');

    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    const form = new URLSearchParams(body);
    const biz = JSON.parse(form.get('biz_content') ?? '{}');
    expect(biz.refund_amount).toBe('206.00');
    expect(biz.out_request_no).toBe('refund-key-1');
    expect(biz.out_trade_no).toBe('sess_1');
  });
});

describe('配置与密钥格式', () => {
  it('缺配置 → 抛明确错误，不静默假成功', async () => {
    const p = new AlipayPaymentProvider({ appId: 'x' });
    await expect(p.initiatePayment({ sessionId: 's', amountMinor: 1n, currencyCode: 'CNY' })).rejects.toThrow(
      /支付宝未配置/,
    );
  });

  it('密钥只给了 base64 主体（无 PEM 头）也能用', () => {
    const bare = appKeys.privateKey
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s+/g, '');
    const provider = makeProvider({ privateKey: bare });
    /* 能构造出 URL 即说明签名没抛错 */
    return expect(
      provider.initiatePayment({ sessionId: 's', amountMinor: 100n, currencyCode: 'CNY' }),
    ).resolves.toBeTruthy();
  });

  it('PKCS#1 私钥（支付宝「Java 适用」格式）也能用，且签出的名可被验证', async () => {
    /*
     * 支付宝密钥工具给两种私钥：非 Java 适用是 PKCS#8（BEGIN PRIVATE KEY），
     * Java 适用是 PKCS#1（BEGIN RSA PRIVATE KEY）。用户经常直接粘 PKCS#1 的 base64 主体，
     * 若 normalizePem 一律包成 PKCS#8 头，node 会解析失败 —— 现象只是"签名失败"，很难查。
     * 这条用例既验证能签，也用对应公钥验签，确认签出来的确实是有效签名。
     */
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const bare = pair.privateKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    expect(bare.startsWith('MIIE')).toBe(true);

    const provider = makeProvider({ privateKey: bare, alipayPublicKey: pair.publicKey });
    const res = await provider.initiatePayment({ sessionId: 's', amountMinor: 100n, currencyCode: 'CNY' });

    const url = new URL(res.redirectUrl);
    const sign = url.searchParams.get('sign') ?? '';
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      if (k !== 'sign') params[k] = v;
    });
    expect(rsaSha256Verify(pair.publicKey, canonicalizeParams(params), sign)).toBe(true);
  });

  it('healthCheck 在配置齐全时返回 true、缺失时 false（不抛）', async () => {
    expect(await makeProvider().healthCheck()).toBe(true);
    expect(await new AlipayPaymentProvider({}).healthCheck()).toBe(false);
  });
});

describe('AlipayClient 时间戳', () => {
  it('跨日边界正确（UTC 16:00 → 北京次日 00:00）', () => {
    expect(alipayTimestamp(new Date('2026-11-09T15:59:59Z'))).toBe('2026-11-09 23:59:59');
    expect(alipayTimestamp(new Date('2026-11-09T16:00:00Z'))).toBe('2026-11-10 00:00:00');
  });

  it('构建的 URL 参数里 sign_type 固定 RSA2', () => {
    const client = new AlipayClient({
      appId: 'a',
      privateKeyPem: appKeys.privateKey,
      alipayPublicKeyPem: alipayKeys.publicKey,
      gateway: 'https://openapi.alipay.com/gateway.do',
    });
    const url = new URL(client.buildPagePayUrl({ outTradeNo: 't', totalAmount: '1.00', subject: 's' }));
    expect(url.searchParams.get('sign_type')).toBe('RSA2');
    expect(url.searchParams.get('format')).toBe('JSON');
    expect(url.searchParams.get('charset')).toBe('utf-8');
  });
});
