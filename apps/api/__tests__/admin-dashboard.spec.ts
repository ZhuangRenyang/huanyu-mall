import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 后台工作台（ADR-030）。
 *
 * 只验薄壳：权限、返回结构、口径字段齐全。
 * 真正的口径（今日只算已付款、待发货只算没发完）在订单模块里，
 * 这里不复刻 SQL 逻辑。
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

describe("后台工作台", () => {
  it("未登录 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/dashboard" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("staff（有 orders 权限）可读", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/dashboard",
        headers: { authorization: "Bearer staff" },
      });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  it("返回四块数据：今日、待办、订单状态计数、最近订单", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/dashboard",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.today).toMatchObject({
        paid_orders: expect.any(Number),
        paid_amount_minor: expect.any(Number),
      });
      expect(typeof data.today.currency_code).toBe("string");
      expect(data.pending).toMatchObject({
        to_fulfill: expect.any(Number),
        refunds: expect.any(Number),
        low_stock: expect.any(Number),
        low_stock_threshold: expect.any(Number),
      });
      expect(Array.isArray(data.recent_orders)).toBe(true);
      expect(typeof data.order_status_counts).toBe("object");
    });
  });
});

describe("库存预警（ADR-074）", () => {
  it("低库存规格数来自库存模块，阈值随响应下发（前端不抄数）", async () => {
    await withApp(async (app, deps) => {
      deps.state.lowStockCount = 3;
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/dashboard",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const pending = res.json().data.pending as {
        low_stock?: number;
        low_stock_threshold?: number;
      };
      expect(pending.low_stock).toBe(3);
      expect(pending.low_stock_threshold).toBe(5);
    });
  });

  it("没有低库存时返回 0，而不是缺字段（前端不用判空）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/dashboard",
        headers: { authorization: "Bearer admin" },
      });
      const pending = res.json().data.pending as { low_stock?: number };
      expect(pending.low_stock).toBe(0);
    });
  });
});
