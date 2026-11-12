import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 商品分类后台接口（ADR-028）。
 *
 * 只验薄壳：权限、两级约束的报错透出、商品保存真的带上分类。
 * 层级与删除保护的完整规则在 product 模块单测里守着。
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

const adminJson = { authorization: "Bearer admin", "content-type": "application/json" };
const staffJson = { authorization: "Bearer staff", "content-type": "application/json" };

describe("商品分类（后台）", () => {
  it("未登录 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/categories" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("staff 有 products 权限，可读分类", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/categories",
        headers: { authorization: "Bearer staff" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.count).toBeGreaterThan(0);
    });
  });

  it("新建一级分类 → 201，列表里能看到", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/categories",
        headers: adminJson,
        payload: { name: "家居", sort_order: 3 },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().data.id;

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/categories",
        headers: { authorization: "Bearer admin" },
      });
      const items = list.json().data.items as Array<{ id: string; name: string }>;
      expect(items.some((c) => c.id === id && c.name === "家居")).toBe(true);
    });
  });

  it("新建分类落审计", async () => {
    await withApp(async (app, deps) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/categories",
        headers: adminJson,
        payload: { name: "家居" },
      });
      expect(deps.auditRepo.rows.some((r) => r.action === "category.create")).toBe(true);
    });
  });

  it("有商品的分类删除 → 409，并把数量说清楚", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/v1/admin/categories/cat_1",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toContain("商品");
    });
  });

  it("改商品分类：PATCH category_ids 真的生效（不静默丢字段）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/products/prod_1",
        headers: adminJson,
        payload: { category_ids: ["cat_2"] },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.category_ids).toEqual(["cat_2"]);
    });
  });

  it("店面分类接口返回真实分类（含两级与商品数）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/categories" });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{
        id: string;
        parent_id: string | null;
        product_count: number;
      }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((c) => c.parent_id === null)).toBe(true);
      expect(items.some((c) => c.parent_id !== null)).toBe(true);
      expect(typeof items[0]!.product_count).toBe("number");
    });
  });
});
