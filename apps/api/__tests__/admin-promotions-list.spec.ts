import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 营销三张列表的筛选、搜索与分页（ADR-043）。
 *
 * 修的是同一类坑：促销列表曾把 type/status 做成「拉 MAX_PAGE_OFFSET 条再内存过滤」，
 * 活动超过一页时第二页起永远拿不到。这里守「筛选在查询里、总数是服务端口径」。
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

const admin = { authorization: "Bearer admin", "content-type": "application/json" };

describe("营销列表筛选与搜索", () => {
  it("促销：按名称搜到 1 条，搜不到返回 count=0（而不是全量）", async () => {
    await withApp(async (app) => {
      // 先建一条可搜到的促销
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions",
        headers: admin,
        payload: { name: "秋季满减", type: "order", status: "active" },
      });
      expect([200, 201], created.body).toContain(created.statusCode);

      const hit = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions?q=秋季",
        headers: { authorization: "Bearer admin" },
      });
      expect(hit.statusCode, hit.body).toBe(200);
      expect(hit.json().data.count).toBe(1);

      const miss = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions?q=不存在的活动",
        headers: { authorization: "Bearer admin" },
      });
      expect(miss.json().data.count).toBe(0);
      expect(miss.json().data.items).toEqual([]);
    });
  });

  it("促销：type 筛选不会把别的类型算进来", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions",
        headers: admin,
        payload: { name: "目录活动", type: "catalogue", status: "active" },
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions?type=order",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.json().data.count).toBe(0);
    });
  });

  it("优惠券：按名称搜索；搜不到返回空列表", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: admin,
        payload: { name: "满 199 减 20", discount_type: "fixed", discount_value: 2000 },
      });
      const hit = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions/vouchers?q=199",
        headers: { authorization: "Bearer admin" },
      });
      expect(hit.statusCode, hit.body).toBe(200);
      expect(hit.json().data.count).toBe(1);

      const miss = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions/vouchers?q=满 999",
        headers: { authorization: "Bearer admin" },
      });
      expect(miss.json().data.count).toBe(0);
    });
  });

  it("礼品卡：按卡号搜索", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/gift-cards",
        headers: admin,
        payload: { currency: "CNY", initial_balance: 10000 },
      });
      expect([200, 201], created.body).toContain(created.statusCode);
      const code = created.json().data.code as string;

      const hit = await app.inject({
        method: "GET",
        url: `/api/v1/admin/promotions/gift-cards?q=${encodeURIComponent(code.slice(0, 6))}`,
        headers: { authorization: "Bearer admin" },
      });
      expect(hit.statusCode, hit.body).toBe(200);
      expect(hit.json().data.count).toBe(1);
    });
  });

  it("分页：limit/offset 与 count 独立（不是当前页条数）", async () => {
    await withApp(async (app) => {
      for (const name of ["活动 A", "活动 B", "活动 C"]) {
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/promotions",
          headers: admin,
          payload: { name, type: "order", status: "draft" },
        });
      }
      const page2 = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions?limit=1&offset=1",
        headers: { authorization: "Bearer admin" },
      });
      expect(page2.json().data.items).toHaveLength(1);
      expect(page2.json().data.count).toBe(3);
      expect(page2.json().data.hasMore).toBe(true);
    });
  });
});
