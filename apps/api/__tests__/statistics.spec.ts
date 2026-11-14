import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/** 统计报表（ADR-097）：近 30 天交易汇总 + 状态分布 + 销量排行。 */
async function withApp(fn: (app: Awaited<ReturnType<typeof buildApp>>, deps: any) => Promise<void>) {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

describe("统计报表（ADR-097）", () => {
  it("返回近 30 天交易汇总、状态分布与销量排行", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderCreated = true;
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/statistics",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data as {
        sales: { orders: number; sales_minor: number; refunds_minor: number; avg_order_minor: number };
        order_status_counts: Record<string, number>;
        top_products: Array<{ variant_id: string; sold_quantity: number }>;
      };
      expect(data.sales.orders).toBe(1);
      expect(data.sales.sales_minor).toBeGreaterThan(0);
      expect(data.order_status_counts.paid).toBe(1);
      expect(data.top_products.length).toBeGreaterThan(0);
      expect(data.top_products[0]?.variant_id).toBe("var_1");
    });
  });

  it("没有订单时返回 0，而不是缺字段", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/statistics",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data as { sales: { orders: number; sales_minor: number } };
      expect(data.sales.orders).toBe(0);
      expect(data.sales.sales_minor).toBe(0);
    });
  });
});
