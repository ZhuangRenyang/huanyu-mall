import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 我的评价（ADR-054）。
 *
 * 顾客写完评价就再也看不到它了：改过了没、商家回没回、还在不在展示，都无处可查。
 * 这里守三件事：
 * 1. 必须登录（匿名不能翻评价列表）；
 * 2. 只返回自己的（customerId 从 token 取，query 传别人的没用）；
 * 3. 被商家隐藏的评价仍然返回，并带 is_visible=false。
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
const admin = { authorization: "Bearer admin", "content-type": "application/json" };

/** 先写一条评价，作为「我的评价」的数据。 */
async function writeOneReview(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/store/reviews",
    headers: customer,
    payload: { order_id: "ord_1", product_id: "prod_1", rating: 5, content: "很好用" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data.id as string;
}

describe("我的评价", () => {
  it("未登录 → 401（评价列表含顾客身份，不能匿名读）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/customer/reviews" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("返回自己写过的评价：商品名快照 + 评分 + 内容", async () => {
    await withApp(async (app) => {
      await writeOneReview(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/reviews",
        headers: { authorization: "Bearer customer" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        product_id: "prod_1",
        product_title: "无线静音鼠标",
        rating: 5,
        content: "很好用",
        is_visible: true,
      });
    });
  });

  it("query 传别人的 customer_id 无效：只认 token 里的身份", async () => {
    await withApp(async (app) => {
      await writeOneReview(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/reviews?customer_id=cust_2",
        headers: { authorization: "Bearer customer" },
      });
      // 仍然是自己的那一条（如果路由把 query 传下去，这里会是 0 条）
      expect(res.json().data.items).toHaveLength(1);
    });
  });

  it("被商家隐藏的评价仍然列出，带 is_visible=false（顾客该知道它没展示）", async () => {
    await withApp(async (app) => {
      const reviewId = await writeOneReview(app);
      // 商家隐藏
      const hide = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/reviews/${reviewId}`,
        headers: admin,
        payload: { is_visible: false },
      });
      expect(hide.statusCode, hide.body).toBe(200);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/reviews",
        headers: { authorization: "Bearer customer" },
      });
      expect(res.json().data.items[0].is_visible).toBe(false);
    });
  });

  it("没写过评价就是空列表（不是 404，页面显示「还没写过」）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/reviews",
        headers: { authorization: "Bearer customer" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.items).toHaveLength(0);
      expect(res.json().data.count).toBe(0);
    });
  });
});
