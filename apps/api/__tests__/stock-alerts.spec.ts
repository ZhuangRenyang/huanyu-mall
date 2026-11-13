import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 到货提醒（ADR-059）。
 *
 * 守四件事：
 * 1. 售罄才登记 —— 有货还让人等邮件，是耍人；
 * 2. 游客必须填邮箱，登录顾客用账号邮箱；
 * 3. 回显脱敏邮箱（顾客要能确认发到哪，但页面不必打出完整地址）；
 * 4. 重复登记幂等（返回同一条，不报错）。
 */
async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    deps: ReturnType<typeof makeDeps>,
  ) => Promise<void>,
) {
  const deps = makeDeps();
  // 默认假库存是 12（有货）；到货提醒的用例统一按售罄跑
  deps.state.variantAvailable = 0;
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const json = { "content-type": "application/json" };
const asCustomer = { ...json, authorization: "Bearer customer" };

describe("到货提醒", () => {
  it("售罄 + 游客填邮箱 → 201，回显脱敏邮箱", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/stock-alerts",
        headers: json,
        payload: { product_id: "prod_1", variant_id: "var_1", email: "Buyer@Example.com" },
      });
      expect(res.statusCode, res.body).toBe(201);
      // 邮箱统一小写后脱敏：同一个人大小写不同不该存两条
      expect(res.json().data.email).toBe("b***@example.com");
      expect(res.json().data.variant_id).toBe("var_1");
    });
  });

  it("游客不填邮箱 → 400（没有地址就没法通知）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/stock-alerts",
        headers: json,
        payload: { product_id: "prod_1", variant_id: "var_1" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("登录顾客不填邮箱 → 用账号邮箱登记", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/stock-alerts",
        headers: asCustomer,
        payload: { product_id: "prod_1", variant_id: "var_1" },
      });
      expect(res.statusCode, res.body).toBe(201);
      // 假顾客邮箱 a@b.com
      expect(res.json().data.email).toBe("a***@b.com");
    });
  });

  it("有货时拒绝登记（别让人白等一封「已到货」）", async () => {
    await withApp(async (app, deps) => {
      deps.state.variantAvailable = 12;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/stock-alerts",
        headers: json,
        payload: { product_id: "prod_1", variant_id: "var_1", email: "a@b.com" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("有货");
    });
  });

  it("返回有效期截止时间（ADR-069）：登记后 30 天内有效", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/stock-alerts",
        headers: json,
        payload: { product_id: "prod_1", variant_id: "var_1", email: "a@b.com" },
      });
      expect(res.statusCode, res.body).toBe(201);
      const expiresAt = Date.parse(res.json().data.expires_at as string);
      expect(Number.isNaN(expiresAt)).toBe(false);
      // 30 天左右（允许几秒误差）
      const days = (expiresAt - Date.now()) / (24 * 3600 * 1000);
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
    });
  });

  it("同一邮箱重复登记幂等：返回同一条，不报错", async () => {
    await withApp(async (app) => {
      const payload = { product_id: "prod_1", variant_id: "var_1", email: "a@b.com" };
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/store/stock-alerts",
        headers: json,
        payload,
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/store/stock-alerts",
        headers: json,
        payload,
      });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json().data.id).toBe(first.json().data.id);
    });
  });
});
