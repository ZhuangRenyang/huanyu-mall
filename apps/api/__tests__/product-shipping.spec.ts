import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 商品的运费归属（ADR-021，对齐淘宝发布页的「物流信息」）。
 *
 * 重点守一个真会发生的 bug：请求体是 snake_case、服务层是 camelCase，
 * 用 `{ ...body }` 透传会让 `shipping_profile_id` 静默丢掉——
 * 商品保存成功、界面显示已选模板，实际没生效，结账仍按默认模板收钱。
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

describe("商品运费归属接口", () => {
  it("更新商品能保存运费模板与卖家包邮（字段不能静默丢）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/products/prod_1",
        headers: adminJson,
        payload: { shipping_profile_id: "shprof_heavy", free_shipping: true },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.shipping_profile_id).toBe("shprof_heavy");
      expect(data.free_shipping).toBe(true);
    });
  });

  it("只改标题时不动运费设置（不传=不改）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/products/prod_1",
        headers: adminJson,
        payload: { title: "新标题" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.title).toBe("新标题");
      // 未传的字段不应被写成 undefined/null
      expect(data).not.toHaveProperty("shipping_profile_id", null);
    });
  });

  it("建商品时可以带上运费模板", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: adminJson,
        payload: {
          title: "重货",
          handle: "heavy-1",
          shipping_profile_id: "shprof_heavy",
          free_shipping: false,
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    });
  });
});
