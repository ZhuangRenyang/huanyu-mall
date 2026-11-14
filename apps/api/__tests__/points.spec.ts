import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 积分（ADR-093）：订单完成发放，全程不碰钱（积分不可提现）。
 *
 * 测试守住两条：确认收货发积分、积分开关关着不发。
 */
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

const cust = { authorization: "Bearer customer", "content-type": "application/json" };

/** 把订单推到已发货，并开启积分开关。 */
async function seedShippedWithPoints(deps: any): Promise<void> {
  deps.state.orderCreated = true;
  // 把 ord_1 设成 cust_1 的单，确认收货才能发积分
  deps.state.orderCustomerId = "cust_1";
  const orderService = deps.services.order as unknown as {
    updateStatus: (id: string, s: string) => Promise<void>;
  };
  await orderService.updateStatus("ord_1", "fulfilled");
  await deps.services.promotion.setFeatureEnabled("points", true);
}

describe("积分（ADR-093）", () => {
  it("确认收货后按实付发放积分，同一订单只发一次", async () => {
    await withApp(async (app, deps) => {
      await seedShippedWithPoints(deps);
      // 实付 10700 minor → 107 点
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/confirm-receipt",
        headers: cust,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(await deps.services.promotion.getPointBalance("cust_1")).toBe(107n);

      // 重复确认会因状态机拒绝（already completed），但服务层幂等也要守住：
      // 再直接发一次，余额不翻倍
      await deps.services.promotion.earnPointsForOrder("cust_1", "ord_1", 10700n);
      expect(await deps.services.promotion.getPointBalance("cust_1")).toBe(107n);
    });
  });

  it("积分开关关着 → 确认收货不发积分", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderCreated = true;
      const orderService = deps.services.order as unknown as {
        updateStatus: (id: string, s: string) => Promise<void>;
      };
      await orderService.updateStatus("ord_1", "fulfilled");
      // 不开启 points 开关（默认关）
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/confirm-receipt",
        headers: cust,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(await deps.services.promotion.getPointBalance("cust_1")).toBe(0n);
    });
  });
});
  it("我的积分：余额 + 流水可见", async () => {
    await withApp(async (app, deps) => {
      await seedShippedWithPoints(deps);
      await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/confirm-receipt",
        headers: cust,
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/points",
        headers: cust,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data as { balance: string; items: Array<{ kind: string; delta: string }> };
      expect(data.balance).toBe("107");
      expect(data.items).toHaveLength(1);
      expect(data.items[0]?.kind).toBe("earn");
    });
  });
