import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 后台客户管理（淘宝「客户运营 → 客户列表」）。
 *
 * 只做查看：注册登录在店面。这里守三件事：
 * 1. 要有 customers 权限（staff 有、未登录没有）；
 * 2. 列表必须带订单数与消费额（商家看的是「谁是大客户」，不是一列邮箱）；
 * 3. 详情要能一次拿到地址与最近订单，不用前端再发三个请求。
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
const staff = { authorization: "Bearer staff" };

describe("后台客户管理", () => {
  it("未登录 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/customers" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("staff（有 customers 权限）可读列表，且带订单数与消费额", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/customers",
        headers: staff,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.items[0].email).toBe("a@b.com");
      expect(data.items[0].order_count).toBe(2);
      expect(data.items[0].total_spent_minor).toBe(21400);
      expect(data.items[0].last_order_at).toBeTruthy();
    });
  });

  it("客户详情：一次返回资料 + 地址 + 最近订单", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/customers/cust_1",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.email).toBe("a@b.com");
      expect(Array.isArray(data.addresses)).toBe(true);
      expect(Array.isArray(data.orders)).toBe(true);
      // 订单带行项，详情页才能显示「买了什么」
      expect(data.orders[0].line_items.length).toBeGreaterThan(0);
    });
  });

  it("搜索参数被接受（按邮箱/姓名过滤）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/customers?q=a@b",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.count).toBeGreaterThanOrEqual(0);
    });
  });

  it("不存在的客户 → 404", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/customers/cust_missing",
        headers: admin,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
