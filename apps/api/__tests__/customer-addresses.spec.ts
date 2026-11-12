import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 顾客地址簿（ADR-026）。
 *
 * 只验薄壳：登录要求、字段放宽后的入参校验、「设为默认」是独立动作。
 * 默认唯一的真正实现（先清后设、同一事务）在 customer 模块单测里守着。
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

const customerJson = { authorization: "Bearer customer", "content-type": "application/json" };

describe("顾客地址簿", () => {
  it("未登录读地址 → 401（地址含姓名电话，不能匿名读）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/customer/addresses" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("已登录：返回自己的地址，带默认标记", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/addresses",
        headers: { authorization: "Bearer customer" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.count).toBe(1);
      expect(data.items[0].is_default_shipping).toBe(true);
    });
  });

  it("中文地址口径：只填收件人 + 详细地址 + 国家也能建（邮编/城市不强制）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/customer/addresses",
        headers: customerJson,
        payload: {
          first_name: "张三",
          line1: "科技园路 1 号 3 栋 501",
          province: "广东省深圳市南山区",
          country_code: "cn",
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().data.country_code).toBe("CN");
    });
  });

  it("缺少收件人 → 400", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/customer/addresses",
        headers: customerJson,
        payload: { line1: "科技园路 1 号", country_code: "CN" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("设为默认是独立动作：POST /:id/default", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/customer/addresses/addr_1/default",
        headers: { authorization: "Bearer customer" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({
        id: "addr_1",
        is_default_shipping: true,
      });
    });
  });

  it("设默认为写操作，未登录被拒", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/customer/addresses/addr_1/default",
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
