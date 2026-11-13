import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 商品收藏（ADR-048）。
 *
 * 淘宝的「收藏宝贝」：详情页一颗星，账户页一个收藏夹。
 * 这里守：必须登录、重复收藏幂等、取消后不再出现、收藏不存在的商品被拒、
 * 列表给的是与商品列表同一套卡片数据。
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
const PRODUCT = "prod_1";

describe("商品收藏", () => {
  it("未登录三个接口都是 401", async () => {
    await withApp(async (app) => {
      for (const [method, url] of [
        ["GET", "/api/v1/store/customer/favorites"],
        ["GET", "/api/v1/store/customer/favorites/ids"],
        ["POST", `/api/v1/store/customer/favorites/${PRODUCT}`],
      ] as const) {
        const res = await app.inject({ method, url });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
      }
    });
  });

  it("收藏后 ids 与列表都能看到，重复收藏幂等", async () => {
    await withApp(async (app) => {
      const first = await app.inject({
        method: "POST",
        url: `/api/v1/store/customer/favorites/${PRODUCT}`,
        headers: customer,
      });
      expect(first.statusCode, first.body).toBe(204);

      // 连点两下：不报错、也不产生两条
      const again = await app.inject({
        method: "POST",
        url: `/api/v1/store/customer/favorites/${PRODUCT}`,
        headers: customer,
      });
      expect(again.statusCode).toBe(204);

      const ids = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/favorites/ids",
        headers: customer,
      });
      expect(ids.json().data.product_ids).toEqual([PRODUCT]);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/favorites",
        headers: customer,
      });
      expect(list.statusCode, list.body).toBe(200);
      const data = list.json().data;
      expect(data.count).toBe(1);
      // 卡片数据与商品列表同源：有 title 与价格
      expect(data.items[0]).toMatchObject({ id: PRODUCT });
      expect(data.items[0].title).toBe("T恤");
      expect(data.items[0].price).toBeTruthy();
    });
  });

  it("取消收藏后 ids 为空、列表为空", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: `/api/v1/store/customer/favorites/${PRODUCT}`,
        headers: customer,
      });
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/store/customer/favorites/${PRODUCT}`,
        headers: customer,
      });
      expect(del.statusCode).toBe(204);

      const ids = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/favorites/ids",
        headers: customer,
      });
      expect(ids.json().data.product_ids).toEqual([]);

      // 重复取消也是幂等的
      const again = await app.inject({
        method: "DELETE",
        url: `/api/v1/store/customer/favorites/${PRODUCT}`,
        headers: customer,
      });
      expect(again.statusCode).toBe(204);
    });
  });

  it("收藏不存在的商品 → 404（防止收藏页留空行）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/customer/favorites/prod_missing",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(404);
    });
  });

  it("列表返回空集合而不是 500（新顾客还没收藏过）", async () => {
    await withApp(async (app) => {
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/favorites",
        headers: customer,
      });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json().data).toMatchObject({ items: [], count: 0, hasMore: false });
    });
  });
});
