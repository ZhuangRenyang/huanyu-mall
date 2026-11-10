/**
 * live 模式购物车同步测试。
 *
 * 锁三件容易出错的事：
 * 1. 后端行的主键是 cli_xxx（不是 variant_id），改量/删行必须用行 id；
 * 2. 后端 addLineItem 每次都插新行、不合并同变体 ——
 *    所以「再加一次同款」必须走改量，否则后端会出现两行同商品（重复扣款）；
 * 3. 后端购物车是唯一事实来源：本地多出来的行必须丢掉，
 *    否则「页面显示的合计」与「实际扣的金额」会不一致。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

interface Line {
  id: string;
  variant_id: string;
  product_id: string;
  title: string;
  quantity: number;
  unit_price_minor: number;
  currency_code: string;
}

interface CartState {
  id: string;
  email: string | null;
  lines: Line[];
}

/**
 * 有状态的假后端：行为与真实后端一致（加购不合并同变体、删行返回 204、
 * 改量按行 id 定位）。这样测试才能验出「并发加购变两行」这类问题。
 */
function fakeBackend() {
  const calls: Recorded[] = [];
  const carts = new Map<string, CartState>();
  let lineSeq = 0;
  let cartSeq = 0;

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    const path = url.split("?")[0] ?? url;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });

    const ok = (data: unknown, status = 200) =>
      new Response(JSON.stringify({ code: 0, data, message: "" }), {
        status,
        headers: { "content-type": "application/json" },
      });
    const fail = (message: string, status = 404) =>
      new Response(JSON.stringify({ code: 30001, data: null, message }), {
        status,
        headers: { "content-type": "application/json" },
      });

    // POST /api/v1/store/carts
    if (method === "POST" && path === "/api/v1/store/carts") {
      const id = `cart_${++cartSeq}`;
      const b = body as { email?: string } | undefined;
      carts.set(id, { id, email: b?.email ?? null, lines: [] });
      return ok(mapCart(carts.get(id)!), 201);
    }

    // POST /api/v1/store/carts/:id/line-items
    let m = path.match(/^\/api\/v1\/store\/carts\/([^/]+)\/line-items$/);
    if (method === "POST" && m) {
      const cart = carts.get(m[1]!);
      if (!cart) return fail("cart not found");
      const b = body as { variant_id: string; quantity: number };
      // 关键行为：后端不合并同变体，每次都插新行。
      cart.lines.push({
        id: `cli_${++lineSeq}`,
        variant_id: b.variant_id,
        product_id: "prod_1",
        title: "黑色",
        quantity: b.quantity,
        unit_price_minor: 19900,
        currency_code: "CNY",
      });
      return ok(mapCart(cart), 201);
    }

    // PATCH /api/v1/store/carts/:id/line-items/:lineId
    m = path.match(/^\/api\/v1\/store\/carts\/([^/]+)\/line-items\/([^/]+)$/);
    if (method === "PATCH" && m) {
      const cart = carts.get(m[1]!);
      if (!cart) return fail("cart not found");
      const line = cart.lines.find((l) => l.id === m![2]);
      if (!line) return fail("line not found");
      line.quantity = (body as { quantity: number }).quantity;
      return ok(mapCart(cart));
    }

    // DELETE /api/v1/store/carts/:id/line-items/:lineId
    if (method === "DELETE" && m) {
      const cart = carts.get(m[1]!);
      if (!cart) return fail("cart not found");
      const idx = cart.lines.findIndex((l) => l.id === m![2]);
      if (idx < 0) return fail("line not found");
      cart.lines.splice(idx, 1);
      // 后端删除返回 204（无响应体）：SDK 会当成 JSON 解析失败抛 ApiError(204)，
      // live-cart 层必须把它识别成「删除成功」。
      return new Response(null, { status: 204 });
    }

    // GET /api/v1/store/carts/:id
    m = path.match(/^\/api\/v1\/store\/carts\/([^/]+)$/);
    if (method === "GET" && m) {
      const cart = carts.get(m[1]!);
      if (!cart) return fail("cart not found");
      return ok(mapCart(cart));
    }

    return fail(`no route for ${method} ${path}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, carts };
}

function mapCart(cart: CartState) {
  return {
    id: cart.id,
    channel_id: "ch_1",
    region_id: "rg_1",
    currency_code: "CNY",
    customer_id: null,
    email: cart.email,
    status: "open",
    totals: null,
    shipping_method: null,
    line_items: cart.lines,
  };
}

async function freshLiveCart() {
  vi.resetModules();
  return import("../lib/live-cart");
}

describe("live 模式：后端购物车同步", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    sessionStorage.clear();
  });

  it("首次加购先建车再加行", async () => {
    const { calls } = fakeBackend();
    const live = await freshLiveCart();

    const cart = await live.addToLiveCart("var_1", 1);
    expect(cart.line_items).toHaveLength(1);

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.path).toBe("/api/v1/store/carts");
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.path).toMatch(/^\/api\/v1\/store\/carts\/cart_1$/);
    expect(calls[2]?.path).toMatch(/^\/api\/v1\/store\/carts\/cart_1\/line-items$/);
    // 只传变体 id + 数量：价格由后端解析（铁律 13，客户端不许自定金额）
    expect(calls[2]?.body).toEqual({ variant_id: "var_1", quantity: 1 });
  });

  it("行 id 与 variant_id 不同，改量/删行用的是行 id", async () => {
    const { calls } = fakeBackend();
    const live = await freshLiveCart();

    const added = await live.addToLiveCart("var_1", 1);
    const lineId = added.line_items[0]!.id;
    expect(lineId).not.toBe("var_1");

    // 改量：请求打的是 cli_xxx（行 id），不是 var_1（变体 id）
    await live.setLiveCartQuantity("var_1", 3);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toMatch(new RegExp(`/line-items/${lineId}$`));
    expect(patch?.body).toEqual({ quantity: 3 });

    // 删行：后端返回 204（无响应体），不能当成失败
    const removed = await live.removeLiveCartLine("var_1");
    expect(removed.line_items).toEqual([]);
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.path).toMatch(new RegExp(`/line-items/${lineId}$`));
  });

  it("再加一次同款走改量而不是新增行（否则重复扣款）", async () => {
    const { calls } = fakeBackend();
    const live = await freshLiveCart();

    await live.addToLiveCart("var_1", 1);
    await live.addToLiveCart("var_1", 1);

    // 只有一次「新增行」，第二次是改量
    const posts = calls.filter((c) => c.method === "POST" && c.path.endsWith("/line-items"));
    expect(posts).toHaveLength(1);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ quantity: 2 });
  });

  it("购物车 id 落在 sessionStorage，刷新不丢车", async () => {
    fakeBackend();
    const live = await freshLiveCart();
    await live.addToLiveCart("var_1", 1);

    // 模拟刷新：模块重新加载，但 sessionStorage 还在
    const reloaded = await freshLiveCart();
    expect(reloaded.getLiveCartId()).toBe("cart_1");
  });

  it("后端购物车里的行覆盖前端缓存的数量与单价（后端是唯一事实来源）", async () => {
    fakeBackend();
    const live = await freshLiveCart();

    const local = [
      {
        id: "var_1",
        title: "无线静音鼠标",
        variantTitle: "黑色",
        quantity: 1,
        unitPriceMinor: 19900,
        currencyCode: "CNY",
      },
    ];
    const serverCart = {
      line_items: [
        {
          id: "cli_1",
          variant_id: "var_1",
          title: "黑色",
          quantity: 5,
          unit_price_minor: 20900,
          currency_code: "CNY",
        },
      ],
    };

    const merged = live.applyLiveCart(local, serverCart as never);
    expect(merged[0]?.quantity).toBe(5);
    expect(merged[0]?.unitPriceMinor).toBe(20900);
    // 展示字段（标题/图片）前端缓存保留
    expect(merged[0]?.title).toBe("无线静音鼠标");
  });

  it("回填时以服务端为准：本地多出来的行被丢掉", async () => {
    fakeBackend();
    const live = await freshLiveCart();

    const local = [
      { id: "var_1", title: "商品一", quantity: 1, unitPriceMinor: 100, currencyCode: "CNY" },
      { id: "var_ghost", title: "没同步上去的商品", quantity: 1, unitPriceMinor: 200, currencyCode: "CNY" },
    ];

    const synced = live.applyLiveCart(local, {
      line_items: [
        {
          id: "cli_1",
          variant_id: "var_1",
          title: "黑色",
          quantity: 1,
          unit_price_minor: 100,
          currency_code: "CNY",
        },
      ],
    } as never);
    expect(synced.map((i) => i.id)).toEqual(["var_1"]);
  });

  it("正在写的行保留本地乐观值（避免行在两次写之间闪没）", async () => {
    const live = await freshLiveCart();
    const local = [
      { id: "var_1", title: "商品一", quantity: 3, unitPriceMinor: 100, currencyCode: "CNY" },
    ];

    // 服务端还没这一行（写入还没回来），但这一行正在写 → 保留本地行
    const pending = live.applyLiveCart(local, { line_items: [] } as never, ["var_1"]);
    expect(pending.map((i) => i.id)).toEqual(["var_1"]);
    expect(pending[0]?.quantity).toBe(3);
  });

  it("订单邮箱没在购物车上时，另建一张带邮箱的车并把行搬过去", async () => {
    // 后端只在「创建购物车」时接受 email，之后没有更新接口；
    // 下单取的是 cart.email，取不到就退化成 guest@example.com。
    const { calls, carts } = fakeBackend();
    const live = await freshLiveCart();

    await live.addToLiveCart("var_1", 1);
    const firstCartId = live.getLiveCartId();

    const moved = await live.prepareCartForOrder({
      email: "buyer@example.com",
      items: [{ variantId: "var_1", quantity: 2 }],
      fingerprint: "fp_1",
    });

    // 换车：带着邮箱的新车，行按原数量搬过去
    expect(moved).not.toBe(firstCartId);
    expect(carts.get(moved)?.email).toBe("buyer@example.com");
    expect(carts.get(moved)?.lines).toEqual([
      expect.objectContaining({ variant_id: "var_1", quantity: 2 }),
    ]);
    // 之后用的是新车
    expect(live.getLiveCartId()).toBe(moved);
    // 建车请求带了邮箱
    const createCall = calls.filter((c) => c.path === "/api/v1/store/carts")[1];
    expect(createCall?.body).toEqual({ email: "buyer@example.com" });
  });

  it("邮箱已经一致时不换车（避免每次提交都新建购物车）", async () => {
    const { calls } = fakeBackend();
    const live = await freshLiveCart();

    await live.addToLiveCart("var_1", 1);

    // 第一次提交：邮箱对不上 → 建带邮箱的新车并搬行
    const first = await live.prepareCartForOrder({
      email: "buyer@example.com",
      items: [{ variantId: "var_1", quantity: 2 }],
      fingerprint: "fp_1",
    });
    // 第二次提交：邮箱一致、内容一致 → 复用同一辆车
    const second = await live.prepareCartForOrder({
      email: "buyer@example.com",
      items: [{ variantId: "var_1", quantity: 2 }],
      fingerprint: "fp_1",
    });
    expect(second).toBe(first);
    // 只建过两辆车：加购时一张 + 首次提交换邮箱时一张
    expect(calls.filter((c) => c.path === "/api/v1/store/carts")).toHaveLength(2);
  });

  it("内容没变时复用原车（重试/连点 → 后端按幂等键重放同一笔订单）", async () => {
    const { calls } = fakeBackend();
    const live = await freshLiveCart();

    await live.addToLiveCart("var_1", 1);
    const cartId = await live.prepareCartForOrder({
      email: "buyer@example.com",
      items: [{ variantId: "var_1", quantity: 2 }],
      fingerprint: "fp_1",
    });
    live.markCartOrdered("fp_1");

    const same = await live.prepareCartForOrder({
      email: "buyer@example.com",
      items: [{ variantId: "var_1", quantity: 2 }],
      fingerprint: "fp_1",
    });
    expect(same).toBe(cartId);
    expect(calls.filter((c) => c.path === "/api/v1/store/carts")).toHaveLength(2);
  });

  it("内容变了就换新车（一车一单，反查支付集合才唯一，金额不会收错）", async () => {
    const { calls } = fakeBackend();
    const live = await freshLiveCart();

    await live.addToLiveCart("var_1", 1);
    const cartId = await live.prepareCartForOrder({
      email: "buyer@example.com",
      items: [{ variantId: "var_1", quantity: 2 }],
      fingerprint: "fp_1",
    });
    live.markCartOrdered("fp_1");

    const second = await live.prepareCartForOrder({
      email: "buyer@example.com",
      items: [{ variantId: "var_1", quantity: 3 }],
      fingerprint: "fp_2",
    });
    expect(second).not.toBe(cartId);
    expect(live.getLiveCartId()).toBe(second);
    expect(calls.filter((c) => c.path === "/api/v1/store/carts")).toHaveLength(3);
  });

  it("并发加购被串行化（同款不会变成两行）", async () => {
    const { calls } = fakeBackend();
    const live = await freshLiveCart();

    await Promise.all([live.addToLiveCart("var_1", 1), live.addToLiveCart("var_1", 1)]);

    // 第二次应该是改量而不是再插一行
    const posts = calls.filter((c) => c.method === "POST" && c.path.endsWith("/line-items"));
    expect(posts).toHaveLength(1);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });
});
