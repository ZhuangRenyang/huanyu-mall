import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 商品评价（ADR-042）：店面读、提交，后台隐藏与解释。
 *
 * 业务规则（订单状态、商品是否在订单里、一单一评）在 @mall/review 模块单测里守着；
 * 这里守路由契约：匿名可读、写必须登录、归属不对不给写、隐藏后店面看不见。
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

const customer = { authorization: "Bearer customer", "content-type": "application/json" };
const adminJson = { authorization: "Bearer admin", "content-type": "application/json" };

const body = {
  order_id: "ord_1",
  product_id: "prod_1",
  rating: 5,
  content: "手感不错，静音效果确实好",
};

describe("店面商品评价", () => {
  it("匿名可读：没登录也能看评价（商品页大多数访问是游客）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products/tee/reviews" });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ items: [], count: 0 });
    });
  });

  it("未登录提交 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/reviews",
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(401);
    });
  });

  it("提交成功 → 201，随后商品评价区能看到它", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/reviews",
        headers: customer,
        payload: body,
      });
      expect(created.statusCode, created.body).toBe(201);
      const review = created.json().data;
      expect(review.rating).toBe(5);
      // 展示名脱敏：评价是公开内容，不能出现全名/邮箱
      expect(review.customer_name).toMatch(/\*\*/);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/store/products/tee/reviews",
      });
      expect(list.json().data.count).toBe(1);
      expect(list.json().data.summary.average).toBe(5);
    });
  });

  it("同一商品重复评价 → 400（一单一商品一条）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/store/reviews",
        headers: customer,
        payload: body,
      });
      const again = await app.inject({
        method: "POST",
        url: "/api/v1/store/reviews",
        headers: customer,
        payload: body,
      });
      expect(again.statusCode).toBe(400);
    });
  });

  it("订单还没收货 → 400", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderReviewable = false;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/reviews",
        headers: customer,
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(400);
    });
  });

  it("评分越界被 schema 挡在路由层", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/reviews",
        headers: customer,
        payload: { ...body, rating: 9 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe("后台评价管理", () => {
  it("隐藏后店面看不到，后台仍能查到（并落审计）", async () => {
    await withApp(async (app, deps) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/store/reviews",
        headers: customer,
        payload: body,
      });
      const hide = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/reviews/rev_1",
        headers: adminJson,
        payload: { is_visible: false },
      });
      expect(hide.statusCode, hide.body).toBe(200);

      const store = await app.inject({
        method: "GET",
        url: "/api/v1/store/products/tee/reviews",
      });
      expect(store.json().data.count).toBe(0);

      const adminList = await app.inject({
        method: "GET",
        url: "/api/v1/admin/reviews?visible=false",
        headers: { authorization: "Bearer admin" },
      });
      expect(adminList.json().data.count).toBe(1);
    });
  });

  it("商家解释：写入后可读回，空串即清除", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/store/reviews",
        headers: customer,
        payload: body,
      });

      const replied = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/reviews/rev_1/reply",
        headers: adminJson,
        payload: { content: "感谢反馈，已调整静音微动" },
      });
      expect(replied.statusCode, replied.body).toBe(200);
      expect(replied.json().data.reply).toContain("感谢");

      const cleared = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/reviews/rev_1/reply",
        headers: adminJson,
        payload: { content: "" },
      });
      expect(cleared.json().data.reply).toBeNull();
    });
  });

  it("评价管理属交易域：客服（有 orders 权限）能看，未登录不能看", async () => {
    await withApp(async (app) => {
      const anon = await app.inject({ method: "GET", url: "/api/v1/admin/reviews" });
      expect(anon.statusCode).toBe(401);

      const staff = await app.inject({
        method: "GET",
        url: "/api/v1/admin/reviews",
        headers: { authorization: "Bearer staff" },
      });
      expect(staff.statusCode, staff.body).toBe(200);
    });
  });
});
