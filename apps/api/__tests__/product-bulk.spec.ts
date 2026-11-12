import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 商品批量操作与列表筛选（对齐淘宝商品管理）。
 *
 * 守三件事：
 * 1. 批量是「一条 SQL 改一批」，不是循环单条 —— 也不会把已删的算进 affected；
 * 2. 数量上限挡住「误点全选删除」这类事故；
 * 3. 列表的 status/q 与页签计数一致，别出现「页签说 3 个、列表给 0 个」。
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
const adminJson = { ...admin, "content-type": "application/json" };

describe("商品批量操作", () => {
  it("批量下架：affects 到实际条数，状态真的变了", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: adminJson,
        payload: { ids: ["prod_1"], action: "unpublish" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ requested: 1, affected: 1 });

      const list = await app.inject({ method: "GET", url: "/api/v1/admin/products?status=draft", headers: admin });
      expect(list.json().data.count).toBe(1);
    });
  });

  it("不存在的 id 不计入 affected（前端据此提示「已不存在」）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: adminJson,
        payload: { ids: ["prod_1", "prod_gone"], action: "publish" },
      });
      expect(res.json().data).toMatchObject({ requested: 2, affected: 1 });
    });
  });

  it("超过 100 条直接 400，避免一次误操作清空全店", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: adminJson,
        payload: { ids: Array.from({ length: 101 }, (_, i) => `prod_${i}`), action: "delete" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("批量删除后列表不再返回该商品", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: adminJson,
        payload: { ids: ["prod_1"], action: "delete" },
      });
      const list = await app.inject({ method: "GET", url: "/api/v1/admin/products", headers: admin });
      expect(list.json().data.count).toBe(0);
    });
  });

  it("空 ids 被挡在参数校验（不是静默成功）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: adminJson,
        payload: { ids: [], action: "publish" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe("商品列表筛选与页签计数", () => {
  it("status 过滤只返回该状态，counts 覆盖全部状态", async () => {
    await withApp(async (app) => {
      const draft = await app.inject({
        method: "GET",
        url: "/api/v1/admin/products?status=draft",
        headers: admin,
      });
      expect(draft.json().data.count).toBe(0);
      expect(draft.json().data.counts).toEqual({ all: 1, published: 1, draft: 0 });

      const published = await app.inject({
        method: "GET",
        url: "/api/v1/admin/products?status=published",
        headers: admin,
      });
      expect(published.json().data.count).toBe(1);
    });
  });

  it("q 按标题搜索；搜不到时计数仍是全量（角标不被搜索影响）", async () => {
    await withApp(async (app) => {
      const hit = await app.inject({
        method: "GET",
        url: "/api/v1/admin/products?q=T恤",
        headers: admin,
      });
      expect(hit.json().data.count).toBe(1);

      const miss = await app.inject({
        method: "GET",
        url: "/api/v1/admin/products?q=不存在的东西",
        headers: admin,
      });
      expect(miss.json().data.count).toBe(0);
      expect(miss.json().data.counts.all).toBe(1);
    });
  });

  it("分页：limit/offset 生效，total 是筛选后的总数", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/products?limit=1&offset=1",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.items).toHaveLength(0);
      expect(res.json().data.count).toBe(1);
      expect(res.json().data.hasMore).toBe(false);
    });
  });
});
