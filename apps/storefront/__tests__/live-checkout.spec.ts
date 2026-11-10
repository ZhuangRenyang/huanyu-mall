/**
 * live 模式收款链路的端到端调用序列测试。
 *
 * 用 mock fetch 把 @mall/sdk 的真实 HTTP 调用截下来，从「加购」一路验到「支付会话」，
 * 断言整条链路的请求顺序与参数：
 *
 *   POST /store/carts                     建车
 *   POST /store/carts/:id/line-items      加行
 *   GET  /store/shipping-options          取运费方案
 *   GET  /store/payment-providers         取支付方式
 *   POST /store/carts/:id/shipping-methods 选运费
 *   POST /store/carts/:id/complete        下单（带 Idempotency-Key）
 *   POST /store/payment-sessions          建支付会话（带 cart_id）
 *
 * 这里锁的是「调用序列」：顺序错了后端就会算错金额或丢 order_id，
 * 而这类错误在 UI 上看不出来。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@mall/sdk";
import {
  cartFingerprint,
  createLivePaymentSession,
  loadLivePaymentProviders,
  loadLiveShippingOptions,
  resolvePaymentLaunch,
  submitLiveCheckout,
  toOrderRecord,
} from "../lib/checkout";

/** 捕获的请求记录。 */
interface Recorded {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** 按「METHOD PATH」路由的假后端。 */
function mockBackend(routes: Record<string, unknown>) {
  const calls: Recorded[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    const path = url.split("?")[0] ?? url;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, headers });

    const data = routes[`${method} ${path}`];
    if (data === undefined) {
      return new Response(
        JSON.stringify({ code: 30001, data: null, message: `no route for ${method} ${path}` }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ code: 0, data, message: "" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const EMPTY_CART = {
  id: "cart_1",
  channel_id: "ch_1",
  region_id: "rg_1",
  currency_code: "CNY",
  customer_id: null,
  email: null,
  status: "open",
  totals: null,
  line_items: [],
  shipping_method: null,
};

const CART_WITH_LINE = {
  ...EMPTY_CART,
  line_items: [
    {
      id: "cli_1",
      variant_id: "var_1",
      product_id: "prod_1",
      title: "黑色",
      quantity: 2,
      unit_price_minor: 19900,
      currency_code: "CNY",
    },
  ],
};

const ORDER: Order = {
  id: "ord_1",
  status: "pending",
  payment_status: "unpaid",
  email: "buyer@example.com",
  currency_code: "CNY",
  subtotal_minor: 39800,
  shipping_minor: 2000,
  tax_minor: 0,
  discount_minor: 0,
  total_minor: 41800,
  line_items: [
    {
      id: "oli_1",
      variant_id: "var_1",
      title: "黑色",
      sku: "sku_1",
      quantity: 2,
      unit_price_minor: 19900,
      total_minor: 39800,
      currency_code: "CNY",
    },
  ],
  placed_at: "2026-01-01T00:00:00.000Z",
};

const QR_SESSION = {
  id: "paysess_1",
  provider_id: "pp_alipay",
  status: "pending",
  amount_minor: 41800,
  currency_code: "CNY",
  context: { kind: "qrcode", qrcode: "https://qr.alipay.com/bax0demo", redirectUrl: null, clientSecret: null },
};

const REDIRECT_SESSION = {
  ...QR_SESSION,
  provider_id: "pp_paypal",
  context: { kind: "redirectUrl", qrcode: null, redirectUrl: "https://paypal.test/approve", clientSecret: null },
};

describe("live 模式：运费与支付方式取自后端", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("运费方案带上国家与购物车 id（后端按小计算运费）", async () => {
    const { calls } = mockBackend({
      "GET /api/v1/store/shipping-options": {
        items: [
          { id: "ship_1", name: "标准跨境专线", type: "flat", amount_minor: 2000, currency_code: "CNY" },
        ],
        count: 1,
      },
    });

    const options = await loadLiveShippingOptions("CN", "cart_1");

    expect(options).toEqual([
      { id: "ship_1", name: "标准跨境专线", eta: undefined, amountMinor: 2000, currencyCode: "CNY" },
    ]);
    expect(calls[0]?.url).toContain("country=CN");
    expect(calls[0]?.url).toContain("cart_id=cart_1");
  });

  it("支付方式用后端返回的 provider 标识（写死标识后端根本不认）", async () => {
    mockBackend({
      "GET /api/v1/store/payment-providers": {
        items: [{ id: "pp_alipay", provider_id: "pp_alipay", label: "支付宝" }],
        count: 1,
      },
    });

    const providers = await loadLivePaymentProviders("cart_1");

    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("pp_alipay");
    expect(providers[0]?.label).toBe("支付宝");
  });
});

describe("live 模式：提交下单的调用序列", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("按「选运费 → 下单 → 建支付会话」顺序调用，且下单带幂等键", async () => {
    const { calls } = mockBackend({
      "POST /api/v1/store/carts/cart_1/shipping-methods": CART_WITH_LINE,
      "POST /api/v1/store/carts/cart_1/complete": ORDER,
      "POST /api/v1/store/payment-sessions": QR_SESSION,
    });

    const { order, session } = await submitLiveCheckout({
      cartId: "cart_1",
      shippingOptionId: "ship_1",
      providerId: "pp_alipay",
      returnUrlFor: (orderId) => `https://shop.test/checkout/result?order=${orderId}`,
      idempotencyKey: "checkout_cart_1",
    });

    // 顺序：运费 → 下单 → 支付会话
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      "POST /api/v1/store/carts/cart_1/shipping-methods",
      "POST /api/v1/store/carts/cart_1/complete",
      "POST /api/v1/store/payment-sessions",
    ]);

    // 选运费只传方案 id，金额由后端解析
    expect(calls[0]?.body).toEqual({ shipping_option_id: "ship_1" });

    // 下单带幂等键：连点两次「去支付」不会产生两笔订单
    expect(calls[1]?.headers["idempotency-key"]).toBe("checkout_cart_1");

    // 支付会话必须带 cart_id：后端据此复用下单时建的支付集合
    expect(calls[2]?.body).toEqual({
      cart_id: "cart_1",
      provider_id: "pp_alipay",
      return_url: "https://shop.test/checkout/result?order=ord_1",
    });

    expect(order.id).toBe("ord_1");
    expect(session.kind).toBe("qrcode");
    expect(session.amountMinor).toBe(41800);
  });

  it("下单失败时不再建支付会话（避免建出没有 order_id 的空壳支付单）", async () => {
    const { calls } = mockBackend({
      "POST /api/v1/store/carts/cart_1/shipping-methods": CART_WITH_LINE,
      "POST /api/v1/store/carts/cart_1/complete": undefined,
      "POST /api/v1/store/payment-sessions": QR_SESSION,
    });

    await expect(
      submitLiveCheckout({
        cartId: "cart_1",
        shippingOptionId: "ship_1",
        providerId: "pp_alipay",
        returnUrlFor: (id) => `https://shop.test/result?order=${id}`,
        idempotencyKey: "checkout_cart_1",
      }),
    ).rejects.toThrow();

    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.url.includes("payment-sessions"))).toBe(false);
  });
});

describe("live 模式：支付会话分流", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("qrcode 形态 → 渲染二维码让用户扫码", async () => {
    mockBackend({ "POST /api/v1/store/payment-sessions": QR_SESSION });
    const session = await createLivePaymentSession({
      cartId: "cart_1",
      providerId: "pp_alipay",
      returnUrl: "https://shop.test/result?order=ord_1",
    });

    expect(resolvePaymentLaunch(session)).toEqual({
      type: "qrcode",
      qrPayload: "https://qr.alipay.com/bax0demo",
    });
  });

  it("redirectUrl 形态 → 整页跳转收银台", async () => {
    mockBackend({ "POST /api/v1/store/payment-sessions": REDIRECT_SESSION });
    const session = await createLivePaymentSession({
      cartId: "cart_1",
      providerId: "pp_paypal",
      returnUrl: "https://shop.test/result?order=ord_1",
    });

    expect(resolvePaymentLaunch(session)).toEqual({
      type: "redirect",
      url: "https://paypal.test/approve",
    });
  });

  it("clientSecret 形态 → 明确报不支持，不静默失败", async () => {
    mockBackend({
      "POST /api/v1/store/payment-sessions": {
        ...QR_SESSION,
        context: { kind: "clientSecret", qrcode: null, redirectUrl: null, clientSecret: "sk_test" },
      },
    });
    const session = await createLivePaymentSession({
      cartId: "cart_1",
      providerId: "pp_stripe",
      returnUrl: "https://shop.test/result?order=ord_1",
    });

    expect(resolvePaymentLaunch(session).type).toBe("unsupported");
  });
});

describe("live 模式：订单状态映射", () => {
  it("payment_status=captured → 已支付", () => {
    const record = toOrderRecord({ ...ORDER, status: "paid", payment_status: "captured" });
    expect(record.status).toBe("paid");
    expect(record.totalMinor).toBe(41800);
    expect(record.currencyCode).toBe("CNY");
    expect(record.items).toEqual([
      { title: "黑色", quantity: 2, unitPriceMinor: 19900 },
    ]);
  });

  it("未收款 → 处理中（轮询等待支付商回调）", () => {
    expect(toOrderRecord(ORDER).status).toBe("processing");
  });

  it("订单取消 / 已退款 → 失败", () => {
    expect(toOrderRecord({ ...ORDER, status: "canceled" }).status).toBe("failed");
    expect(toOrderRecord({ ...ORDER, payment_status: "refunded" }).status).toBe("failed");
  });
});

describe("live 模式：购物车内容指纹", () => {
  const lines = [
    { id: "var_1", quantity: 2 },
    { id: "var_2", quantity: 1 },
  ];

  it("购物车内容不变 → 同一个指纹（连点两次不会下两笔单）", () => {
    const a = cartFingerprint(lines, "ship_1", "buyer@example.com");
    const b = cartFingerprint([...lines].reverse(), "ship_1", "buyer@example.com");
    expect(a).toBe(b);
  });

  it("购物车内容变了 → 不同的指纹（否则改完购物车会拿回上一笔旧订单）", () => {
    const a = cartFingerprint(lines, "ship_1", "buyer@example.com");
    const b = cartFingerprint([{ id: "var_1", quantity: 3 }], "ship_1", "buyer@example.com");
    expect(a).not.toBe(b);
  });

  it("换了运费方案或邮箱 → 不同的指纹", () => {
    const a = cartFingerprint(lines, "ship_1", "buyer@example.com");
    expect(cartFingerprint(lines, "ship_2", "buyer@example.com")).not.toBe(a);
    expect(cartFingerprint(lines, "ship_1", "other@example.com")).not.toBe(a);
  });
});

describe("live 模式：从加购到支付会话的完整链路", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    sessionStorage.clear();
  });

  it("整条链路一次跑通：建车 → 加行 → 取方案 → 选运费 → 下单 → 建支付会话", async () => {
    const { calls } = mockBackend({
      "POST /api/v1/store/carts": EMPTY_CART,
      "GET /api/v1/store/carts/cart_1": EMPTY_CART,
      "POST /api/v1/store/carts/cart_1/line-items": CART_WITH_LINE,
      "GET /api/v1/store/shipping-options": {
        items: [{ id: "ship_1", name: "标准跨境专线", type: "flat", amount_minor: 2000, currency_code: "CNY" }],
        count: 1,
      },
      "GET /api/v1/store/payment-providers": {
        items: [{ id: "pp_alipay", provider_id: "pp_alipay", label: "支付宝" }],
        count: 1,
      },
      "POST /api/v1/store/carts/cart_1/shipping-methods": CART_WITH_LINE,
      "POST /api/v1/store/carts/cart_1/complete": ORDER,
      "POST /api/v1/store/payment-sessions": QR_SESSION,
    });

    const live = await import("../lib/live-cart");

    // 1) 加购：建车 + 加行
    await live.addToLiveCart("var_1", 2);
    const cartId = live.getLiveCartId();
    expect(cartId).toBe("cart_1");

    // 2) 取后端的运费方案与支付方式
    const shipping = await loadLiveShippingOptions("CN", cartId);
    const providers = await loadLivePaymentProviders(cartId);
    expect(shipping[0]?.id).toBe("ship_1");
    expect(providers[0]?.id).toBe("pp_alipay");

    // 3) 提交下单 + 发起支付
    const fingerprint = cartFingerprint([{ id: "var_1", quantity: 2 }], "ship_1", "buyer@example.com");
    const { order, session } = await submitLiveCheckout({
      cartId,
      shippingOptionId: shipping[0]!.id,
      providerId: providers[0]!.id,
      returnUrlFor: (orderId) => `https://shop.test/checkout/result?order=${orderId}`,
      idempotencyKey: `checkout_${cartId}_${fingerprint}`,
    });

    // 4) 二维码形态 → 跳支付页扫码
    expect(resolvePaymentLaunch(session).type).toBe("qrcode");
    expect(order.id).toBe("ord_1");
    expect(session.amountMinor).toBe(41800);

    // 5) 整条链路的请求顺序
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      "POST /api/v1/store/carts",
      "GET /api/v1/store/carts/cart_1",
      "POST /api/v1/store/carts/cart_1/line-items",
      "GET /api/v1/store/shipping-options",
      "GET /api/v1/store/payment-providers",
      "POST /api/v1/store/carts/cart_1/shipping-methods",
      "POST /api/v1/store/carts/cart_1/complete",
      "POST /api/v1/store/payment-sessions",
    ]);
  });
});
