import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 顾客账号与「我的订单」。
 *
 * 守两类东西：
 * 1. **归属**：订单列表只能看自己的，别人的订单详情不能靠知道单号看到；
 * 2. **身份口径**：token 里的 sub 是 identity id，customerId 才是订单归属 ——
 *    之前拿 sub 比 customer_id，已登录顾客查自己的订单反而会被判越权。
 */
async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    deps: ReturnType<typeof makeDeps>,
  ) => Promise<void>,
) {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const customer = { authorization: "Bearer customer" };

describe("我的订单", () => {
  it("未登录 → 401（不是空列表，空列表会让顾客以为订单丢了）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/orders" });
      expect(res.statusCode, res.body).toBe(401);
    });
  });

  it("已登录：返回自己的订单，且带商品行", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.count).toBe(1);
      expect(data.items[0].id).toBe("ord_1");
      expect(Array.isArray(data.items[0].line_items)).toBe(true);
      expect(data.items[0].line_items.length).toBeGreaterThan(0);
    });
  });

  it("query 传 customer_id 无效：归属只认 token", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders?customer_id=cust_2",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      // 仍然只返回 cust_1 的订单；传别人的 id 不会翻到别人的单
      expect(res.json().data.items[0].id).toBe("ord_1");
    });
  });

  it("别人的订单详情 → 403（知道单号也不行）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders/ord_other",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(403);
    });
  });

  it("未登录看有归属的订单 → 403；游客单仍可按单号查", async () => {
    await withApp(async (app) => {
      const other = await app.inject({ method: "GET", url: "/api/v1/store/orders/ord_other" });
      expect(other.statusCode).toBe(403);

      // ord_1 是游客单（customer_id 为空）：不登录也能按单号查
      const guest = await app.inject({ method: "GET", url: "/api/v1/store/orders/ord_1" });
      expect(guest.statusCode, guest.body).toBe(200);
    });
  });

  it("当前顾客资料：按 token 回读，不用前端自己编", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/me",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.email).toBe("a@b.com");
    });
  });
});

describe("顾客地址簿", () => {
  it("未登录 → 401（地址含姓名电话门牌，不能匿名读）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/customer/addresses" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("已登录：能读自己的地址", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/addresses",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.items[0].city).toBe("杭州");
    });
  });

  it("新增地址：国家码统一大写，字段按服务层 camelCase 传", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/customer/addresses",
        headers: { ...customer, "content-type": "application/json" },
        payload: {
          first_name: "三",
          last_name: "张",
          phone: "13800000000",
          line1: "示例路 1 号",
          city: "杭州",
          province: "浙江",
          postal_code: "310000",
          country_code: "cn",
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().data.country_code).toBe("CN");
      expect(res.json().data.customer_id).toBe("cust_1");
    });
  });

  it("删除地址走 customerId + addressId 双参数（服务层自带归属校验）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/v1/store/customer/addresses/addr_1",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(204);
    });
  });
});

describe("订单详情带物流（ADR-033）", () => {
  it("商家填了单号，顾客在订单详情看得到快递公司与单号", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders/ord_1",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(Array.isArray(data.fulfillments)).toBe(true);
      expect(data.fulfillments[0]).toMatchObject({
        id: "fulf_1",
        status: "shipped",
      });
      expect(data.fulfillments[0].tracking_links[0]).toMatchObject({
        carrier: "顺丰",
        number: "SF1",
      });
    });
  });
});

describe("订单详情带支付渠道与配送方式（ADR-034）", () => {
  it("顾客能看到「用什么付的」与「选的什么配送」，不再是写死的渠道名", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderCreated = true;
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders/ord_1",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      // provider_id 是内部标识，展示要用渠道配置里的 label
      expect(data.payment_provider).toMatchObject({ id: "pp_fake", label: "Fake" });
      expect(data.shipping_method).toBeTruthy();
      expect(typeof data.shipping_method.name).toBe("string");
    });
  });
});

describe("我的订单状态页签（ADR-036）", () => {
  it("多状态用逗号分隔：命中与不命中都能正确筛", async () => {
    await withApp(async (app) => {
      const hit = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders?status=pending,awaiting_payment",
        headers: customer,
      });
      expect(hit.statusCode, hit.body).toBe(200);
      expect(hit.json().data.count).toBe(1);

      const miss = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders?status=refunded",
        headers: customer,
      });
      expect(miss.statusCode, miss.body).toBe(200);
      expect(miss.json().data.count).toBe(0);
    });
  });

  it("非法状态值被忽略，不报 400（老前端不会因多传一个值白屏）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders?status=pending,not_a_status",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.count).toBe(1);
    });
  });
});
