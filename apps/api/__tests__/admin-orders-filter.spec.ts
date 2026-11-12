import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 后台订单列表筛选（ADR-031）。
 *
 * 关键回归：筛选与搜索在**服务端**。改造前是拉 100 条再本地筛，
 * 订单一多就静默漏 —— 工作台说「待发货 5」，点进来可能是空列表。
 */
async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    deps: ReturnType<typeof makeDeps>,
  ) => Promise<void>,
) {
  const deps = makeDeps();
  deps.state.orderCreated = true;
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const admin = { authorization: "Bearer admin" };

describe("后台订单列表筛选", () => {
  it("返回 items + count + counts + hasMore（页签角标与分页都靠它）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders", headers: admin });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.count).toBe("number");
      expect(typeof data.counts).toBe("object");
      expect(typeof data.hasMore).toBe("boolean");
      // 行项一并返回：列表的「商品」列没有它就是一列空白
      expect(Array.isArray(data.items[0].line_items)).toBe(true);
    });
  });

  it("按状态集合筛选：命中的状态返回，不命中的为空", async () => {
    await withApp(async (app) => {
      const hit = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders?status=paid,partially_fulfilled",
        headers: admin,
      });
      expect(hit.statusCode, hit.body).toBe(200);

      const miss = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders?status=refunded",
        headers: admin,
      });
      expect(miss.statusCode, miss.body).toBe(200);
      expect(miss.json().data.items).toHaveLength(0);
    });
  });

  it("按订单号或邮箱搜索", async () => {
    await withApp(async (app) => {
      const byId = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders?q=ord_",
        headers: admin,
      });
      expect(byId.statusCode, byId.body).toBe(200);

      const none = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders?q=no-such-order",
        headers: admin,
      });
      expect(none.json().data.items).toHaveLength(0);
    });
  });

  it("status 传单个状态也兼容（老调用方不炸）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders?status=paid",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
    });
  });
});
