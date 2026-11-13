import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 顾客订单留言（ADR-050，淘宝下单页的「给卖家留言」）。
 *
 * 这一条最容易做错的地方不是存不存，而是**谁能看见**：
 * - customer_note：顾客自己 + 商家，必须下发店面；
 * - merchant_note：只有商家，永不下发店面（这点由 product-images-order-note 守着）。
 *
 * 两个字段混用，等于把商家内部备注泄露给顾客，或者顾客的留言商家永远看不到。
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

const admin = { authorization: "Bearer admin" };

/** 下单前必须先有收货国家（ADR-019：税与运费都按国家算）。 */
async function setCountry(app: Awaited<ReturnType<typeof buildApp>>) {
  await app.inject({
    method: "PUT",
    url: "/api/v1/store/carts/cart_1/address",
    headers: { "content-type": "application/json" },
    payload: { country: "CN" },
  });
}

describe("顾客留言（给卖家留言）", () => {
  it("下单时带留言 → 传进 workflow（不是丢在路由里）", async () => {
    await withApp(async (app, deps) => {
      await setCountry(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/carts/cart_1/complete",
        headers: { "idempotency-key": "idem-note-1", "content-type": "application/json" },
        payload: { customer_note: "送货前打电话，别放快递柜" },
      });
      expect(res.statusCode).toBe(201);
      // 假 workflow 不真建单：只能从入参断言路由确实把留言传下去了
      expect(deps.state.lastWorkflowInput?.customerNote).toBe("送货前打电话，别放快递柜");
    });
  });

  it("不带头留言 → 传 null（不传空串，仓储才不会存一串空格）", async () => {
    await withApp(async (app, deps) => {
      await setCountry(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/carts/cart_1/complete",
        headers: { "idempotency-key": "idem-note-2" },
      });
      expect(res.statusCode).toBe(201);
      expect(deps.state.lastWorkflowInput?.customerNote).toBeNull();
    });
  });

  it("超长留言不在路由层 400：宽进严存，截断交给服务层", async () => {
    await withApp(async (app, deps) => {
      await setCountry(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/carts/cart_1/complete",
        headers: { "idempotency-key": "idem-note-3", "content-type": "application/json" },
        payload: { customer_note: "易".repeat(800) },
      });
      expect(res.statusCode).toBe(201);
      expect(String(deps.state.lastWorkflowInput?.customerNote)).toHaveLength(800);
    });
  });

  it("店面订单详情能看到自己的留言（顾客要能回看）", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderCustomerNote = "麻烦用礼盒包装";
      const res = await app.inject({ method: "GET", url: "/api/v1/store/orders/ord_1" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.customer_note).toBe("麻烦用礼盒包装");
    });
  });

  it("后台订单详情也能看到同一条留言，且商家备注单独一个字段", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderCustomerNote = "麻烦用礼盒包装";
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders/ord_1",
        headers: admin,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.customer_note).toBe("麻烦用礼盒包装");
      // 商家备注仍在（默认 null），两者不是同一个字段
      expect(res.json().data).toHaveProperty("merchant_note");
    });
  });
});
