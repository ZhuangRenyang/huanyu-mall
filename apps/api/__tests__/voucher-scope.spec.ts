import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 优惠券适用范围（ADR-064）。
 *
 * 之前后台能选「指定商品」，但 computeDiscounts 不读它 —— 券按整单减，
 * 商家每核销一张就多亏一单。这里守两条边界：
 * 1. 指定商品券必须给出范围（创建/更新两处都拦），否则 400；
 * 2. 范围存得进、读得回（创建响应 / 详情 / 列表都带 scopes）。
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

const auth = { authorization: "Bearer admin", "content-type": "application/json" };

describe("优惠券适用范围", () => {
  it("指定商品券没配范围 → 400（否则是一张永远用不了的券）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: auth,
        payload: { name: "没范围的指定商品券", type: "specific_product", discount_type: "fixed", discount_value: 1000 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("指定商品券配范围 → 201，响应带回 scopes", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: auth,
        payload: {
          name: "指定商品券",
          type: "specific_product",
          discount_type: "fixed",
          discount_value: 1000,
          scopes: [
            { scope_type: "product", scope_id: "prod_1" },
            { scope_type: "category", scope_id: "cat_1" },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().data.scopes).toEqual([
        { scope_type: "product", scope_id: "prod_1" },
        { scope_type: "category", scope_id: "cat_1" },
      ]);
    });
  });

  it("整单券不需要范围（不传 scopes 也成功）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: auth,
        payload: { name: "整单券", discount_type: "fixed", discount_value: 1000 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.scopes).toEqual([]);
    });
  });

  it("更新改成指定商品但没范围 → 400", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: auth,
        payload: { name: "本来是整单", discount_type: "fixed", discount_value: 1000 },
      });
      const id = created.json().data.id as string;

      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/promotions/vouchers/${id}`,
        headers: auth,
        payload: { type: "specific_product" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("列表带出每张券的范围（后台编辑回填与列表摘要用）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: auth,
        payload: {
          name: "列表券",
          type: "specific_product",
          discount_type: "fixed",
          discount_value: 1000,
          scopes: [{ scope_type: "product", scope_id: "prod_9" }],
        },
      });

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/promotions/vouchers?limit=20&offset=0",
        headers: { authorization: "Bearer admin" },
      });
      expect(list.statusCode, list.body).toBe(200);
      const item = (list.json().data.items as Array<{ name: string; scopes?: unknown[] }>).find(
        (v) => v.name === "列表券",
      );
      expect(item?.scopes).toEqual([{ scope_type: "product", scope_id: "prod_9" }]);
    });
  });
});
