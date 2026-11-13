import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 顾客确认收货（ADR-049）。
 *
 * 之前没有任何入口能把订单推到 completed：状态机缺 fulfilled→completed 这条边，
 * 「已完成」页签永远是空的，评价也就只能靠 fulfilled 兜着。
 * 这里守：必须登录、必须是自己的订单、只有待收货能确认。
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

describe("确认收货", () => {
  it("未登录 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/confirm-receipt",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  it("还没发货的订单不能确认收货 → 400", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/confirm-receipt",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(400);
    });
  });

  it("待收货 → 确认后为已完成", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderStatus = "fulfilled";
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/confirm-receipt",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.status).toBe("completed");
    });
  });

  it("别人的订单不能确认（知道单号也不行）→ 403", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderStatus = "fulfilled";
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_other/confirm-receipt",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(403);
    });
  });
});
