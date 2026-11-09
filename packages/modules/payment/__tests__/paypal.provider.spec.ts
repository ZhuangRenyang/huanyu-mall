import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaypalPaymentProvider } from '../src/providers/paypal.js';
import { __clearPaypalTokenCache } from '../src/providers/paypal-client.js';
import { WebhookSignatureError } from '../src/errors.js';

/**
 * PayPal Provider 契约测试（全程 mock fetch，不打真实网络）。
 *
 * 最重要的三条断言：
 * 1. 金额单位 —— PayPal 要**主单位字符串**（"206.00"），与 Stripe 的**最小单位整数**相反。
 *    这条错了就是 100 倍金额差错，必须锁死（含 zero-decimal 的 JPY）。
 * 2. 幂等键原样透传 —— 重复点击/重试不能重复扣款。
 * 3. 错误分层 —— 卡拒是业务结果（返 failed），凭据错/5xx 是对接故障（必须抛）。
 *    把后者咽成 failed，会让"密钥填错"表现为"用户付款失败"，排查成本极高。
 */

const fetchMock = vi.fn();

/** 构造 fetch 响应桩。 */
function res(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const tokenOk = () => res(200, { access_token: 'tok_test_1', expires_in: 32400 });

function makeProvider(overrides: Record<string, unknown> = {}) {
  return new PaypalPaymentProvider({
    clientId: 'cid_test',
    clientSecret: 'sec_test',
    mode: 'sandbox',
    webhookId: 'WH-TEST-1',
    ...overrides,
  });
}

/** 取第 n 次 fetch 调用的 [url, init]。 */
function call(n: number): [string, RequestInit] {
  const args = fetchMock.mock.calls[n];
  return [String(args[0]), args[1] as RequestInit];
}

function bodyOf(n: number): Record<string, any> {
  const init = call(n)[1];
  return JSON.parse(String(init.body));
}

const orderStub = (status: string) =>
  res(200, {
    id: 'ORDER-1',
    status,
    links: [{ rel: 'payer-action', href: 'https://sandbox.paypal.com/checkoutnow?token=ORDER-1' }],
  });

beforeEach(() => {
  __clearPaypalTokenCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('金额单位（与 Stripe 相反，最容易错的地方）', () => {
  it('CNY 的 amountMinor=20600 必须传 "206.00"（主单位字符串）', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(orderStub('CREATED'));
    await makeProvider().initiatePayment({ sessionId: 's1', amountMinor: 20600n, currencyCode: 'CNY' });

    const amount = bodyOf(1).purchase_units[0].amount;
    expect(amount.value).toBe('206.00');
    expect(amount.currency_code).toBe('CNY');
  });

  it('JPY 是 zero-decimal 币种：amountMinor=20600 必须传 "20600"（不是 206.00）', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(orderStub('CREATED'));
    await makeProvider().initiatePayment({ sessionId: 's2', amountMinor: 20600n, currencyCode: 'JPY' });

    expect(bodyOf(1).purchase_units[0].amount.value).toBe('20600');
  });

  it('退款金额同样走主单位字符串', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(res(200, { id: 'REFUND-1', status: 'COMPLETED' }));
    await makeProvider().refundPayment({
      paymentId: 'p1',
      amountMinor: 9900n,
      currencyCode: 'USD',
      idempotencyKey: 'rk1',
      providerReference: 'CAPTURE-1',
    });

    expect(bodyOf(1).amount.value).toBe('99.00');
  });
});

describe('幂等键透传', () => {
  it('initiate 用 init_{sessionId} 派生', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(orderStub('CREATED'));
    await makeProvider().initiatePayment({ sessionId: 'sess-abc', amountMinor: 100n, currencyCode: 'USD' });
    expect((call(1)[1].headers as Record<string, string>)['PayPal-Request-Id']).toBe('init_sess-abc');
  });

  it('capture 原样透传调用方给的 key', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(res(200, { id: 'ORDER-1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1' }] } }] }));
    await makeProvider().capturePayment({
      paymentId: 'p1',
      amountMinor: 100n,
      currencyCode: 'USD',
      idempotencyKey: 'cap-key-9',
      providerReference: 'ORDER-1',
    });
    expect((call(1)[1].headers as Record<string, string>)['PayPal-Request-Id']).toBe('cap-key-9');
  });

  it('refund 原样透传调用方给的 key', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(res(200, { id: 'R1', status: 'COMPLETED' }));
    await makeProvider().refundPayment({
      paymentId: 'p1',
      amountMinor: 100n,
      currencyCode: 'USD',
      idempotencyKey: 'ref-key-7',
      providerReference: 'CAP-1',
    });
    expect((call(1)[1].headers as Record<string, string>)['PayPal-Request-Id']).toBe('ref-key-7');
  });
});

describe('订单状态映射', () => {
  const cases: [string, string][] = [
    ['COMPLETED', 'authorized'],
    ['APPROVED', 'authorized'],
    ['CREATED', 'requires_more'],
    ['PAYER_ACTION_REQUIRED', 'requires_more'],
    ['VOIDED', 'failed'],
  ];

  for (const [paypalStatus, expected] of cases) {
    it(`${paypalStatus} → ${expected}`, async () => {
      fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(orderStub(paypalStatus));
      const out = await makeProvider().authorizePayment({ sessionId: 's', amountMinor: 100n, currencyCode: 'USD', providerReference: 'ORDER-1' });
      expect(out.status).toBe(expected);
    });
  }
});

describe('错误分层', () => {
  it('卡被拒（INSTRUMENT_DECLINED）→ 返回 failed，不抛', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(res(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] }));
    const out = await makeProvider().capturePayment({
      paymentId: 'p',
      amountMinor: 100n,
      currencyCode: 'USD',
      idempotencyKey: 'k',
      providerReference: 'ORDER-1',
    });
    expect(out.status).toBe('failed');
  });

  it('已捕获（ORDER_ALREADY_CAPTURED）→ 幂等成功，不报错', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(res(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }));
    const out = await makeProvider().capturePayment({
      paymentId: 'p',
      amountMinor: 100n,
      currencyCode: 'USD',
      idempotencyKey: 'k',
      providerReference: 'ORDER-1',
    });
    expect(out.status).toBe('captured');
  });

  it('凭据无效（换 token 401）→ 抛出且消息可定位', async () => {
    fetchMock.mockResolvedValueOnce(res(401, { error: 'invalid_client' }));
    await expect(
      makeProvider().initiatePayment({ sessionId: 's', amountMinor: 100n, currencyCode: 'USD' }),
    ).rejects.toThrow(/凭据无效或已撤销/);
  });

  it('PayPal 侧 5xx → 抛出（可重试，不吞成 failed）', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(res(500, { message: 'boom' }));
    await expect(
      makeProvider().capturePayment({
        paymentId: 'p',
        amountMinor: 100n,
        currencyCode: 'USD',
        idempotencyKey: 'k',
        providerReference: 'ORDER-1',
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('无配置时的行为', () => {
  it('缺 Client ID/Secret 时抛明确错误，不静默假成功', async () => {
    const p = new PaypalPaymentProvider({ mode: 'sandbox' });
    await expect(p.initiatePayment({ sessionId: 's', amountMinor: 100n, currencyCode: 'USD' })).rejects.toThrow(
      /PayPal 未配置/,
    );
  });
});

describe('access_token 缓存', () => {
  it('同一 clientId 多次调用只换一次 token（32400 秒有效期不该每笔重取）', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(orderStub('CREATED'))
      .mockResolvedValueOnce(orderStub('CREATED'));
    const p = makeProvider();
    await p.initiatePayment({ sessionId: 's1', amountMinor: 100n, currencyCode: 'USD' });
    await p.initiatePayment({ sessionId: 's2', amountMinor: 100n, currencyCode: 'USD' });

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 次 token + 2 次下单
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/oauth2/token');
  });
});

describe('Webhook', () => {
  it('验签失败 → 抛 WebhookSignatureError（service 会转 401 且不落库）', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(res(200, { verification_status: 'FAILURE' }));
    await expect(
      makeProvider().getWebhookActionAndData({ headers: {}, rawBody: '{"id":"E1","event_type":"PAYMENT.CAPTURE.COMPLETED"}' }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('验签通过 + CAPTURE.COMPLETED → captured，金额转回 minor', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(res(200, { verification_status: 'SUCCESS' }));
    const out = await makeProvider().getWebhookActionAndData({
      headers: { 'paypal-transmission-id': 'tid' },
      rawBody: JSON.stringify({
        id: 'WH-EVENT-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'CAP-1', custom_id: 'sess-1', amount: { value: '206.00', currency_code: 'CNY' } },
      }),
    });
    expect(out.action).toBe('captured');
    expect(out.eventId).toBe('WH-EVENT-1');
    expect(out.data?.amountMinor).toBe(20600n);
    expect(out.data?.sessionId).toBe('sess-1');
  });

  it('CAPTURE.DENIED → failed', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(res(200, { verification_status: 'SUCCESS' }));
    const out = await makeProvider().getWebhookActionAndData({
      headers: {},
      rawBody: JSON.stringify({ id: 'E2', event_type: 'PAYMENT.CAPTURE.DENIED', resource: { id: 'CAP-2' } }),
    });
    expect(out.action).toBe('failed');
  });
});
