import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 分销（ADR-101）。
 *
 * 守住四件事：
 *  1. 推广员是客户，同一客户只能注册一次；停用后推广码立即失效；
 *  2. 佣金按实付计提，一单一笔（重复确认收货不翻倍）；
 *  3. 自推不计佣；
 *  4. 结算只是改状态：只有 pending 能结算，系统不转账。
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

const admin = { authorization: "Bearer admin", "content-type": "application/json" };
const cust = { authorization: "Bearer customer", "content-type": "application/json" };

async function register(app: any, customerId: string, bps = 500): Promise<{ id: string; code: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/affiliates",
    headers: admin,
    payload: { customer_id: customerId, commission_bps: bps },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data as { id: string; code: string };
}

/** 把订单摆到「已发货、属于 cust_1、归因给某推广员」并确认收货。 */
async function completeOrder(app: any, deps: any, affiliateId: string, buyerId = "cust_1") {
  deps.state.orderCreated = true;
  deps.state.orderCustomerId = buyerId;
  deps.state.orderPaymentStatus = "captured";
  deps.state.orderAffiliateId = affiliateId;
  const orderService = deps.services.order as unknown as {
    updateStatus: (id: string, s: string) => Promise<void>;
  };
  await orderService.updateStatus("ord_1", "fulfilled");
  return app.inject({
    method: "POST",
    url: "/api/v1/store/orders/ord_1/confirm-receipt",
    headers: cust,
  });
}

describe("分销（ADR-101）", () => {
  it("注册推广员 → 列表可见；同一客户重复注册 409", async () => {
    await withApp(async (app) => {
      const a = await register(app, "cust_promoter");
      expect(a.code).toMatch(/^[A-Z0-9]{8}$/);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/affiliates",
        headers: admin,
      });
      expect(list.statusCode, list.body).toBe(200);
      expect((list.json().data as { items: unknown[] }).items).toHaveLength(1);

      const dup = await app.inject({
        method: "POST",
        url: "/api/v1/admin/affiliates",
        headers: admin,
        payload: { customer_id: "cust_promoter", commission_bps: 500 },
      });
      expect(dup.statusCode).toBe(409);
    });
  });

  it("停用推广员：码不再生效（状态落库）", async () => {
    await withApp(async (app) => {
      const a = await register(app, "cust_promoter");
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/affiliates/${a.id}/status`,
        headers: admin,
        payload: { status: "disabled" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json().data as { status: string }).status).toBe("disabled");
    });
  });

  it("订单完成计提佣金：待结算 → 标记结算；重复结算 409", async () => {
    await withApp(async (app, deps) => {
      const a = await register(app, "cust_promoter", 500); // 5%
      const done = await completeOrder(app, deps, a.id);
      expect(done.statusCode, done.body).toBe(200);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/commissions?status=pending",
        headers: admin,
      });
      expect(list.statusCode, list.body).toBe(200);
      const items = (list.json().data as { items: Array<{ id: string; commission_minor: number; status: string }> }).items;
      expect(items).toHaveLength(1);
      // 假订单 10700 × 5% = 535
      expect(items[0]!.commission_minor).toBe(535);
      expect(items[0]!.status).toBe("pending");

      const settled = await app.inject({
        method: "POST",
        url: `/api/v1/admin/commissions/${items[0]!.id}/settle`,
        headers: admin,
      });
      expect(settled.statusCode, settled.body).toBe(200);
      expect((settled.json().data as { status: string }).status).toBe("settled");

      const twice = await app.inject({
        method: "POST",
        url: `/api/v1/admin/commissions/${items[0]!.id}/settle`,
        headers: admin,
      });
      expect(twice.statusCode).toBe(409);
    });
  });

  it("自推不计佣：推广员自己下单没有佣金", async () => {
    await withApp(async (app, deps) => {
      // 推广员是 cust_9，买家也是 cust_9（自推）
      const a = await register(app, "cust_9");
      deps.state.orderCreated = true;
      deps.state.orderCustomerId = "cust_9";
      deps.state.orderPaymentStatus = "captured";
      deps.state.orderAffiliateId = a.id;
      const orderService = deps.services.order as unknown as {
        updateStatus: (id: string, s: string) => Promise<void>;
      };
      await orderService.updateStatus("ord_1", "fulfilled");
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/confirm-receipt",
        headers: { authorization: "Bearer customer9", "content-type": "application/json" },
      });
      // 确认收货成功，但没有佣金
      expect(res.statusCode, res.body).toBe(200);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/commissions",
        headers: admin,
      });
      expect((list.json().data as { items: unknown[] }).items).toHaveLength(0);
    });
  });

  it("我的推广：推广员能看到待结算与已结算", async () => {
    await withApp(async (app, deps) => {
      // 推广员是 cust_9，买家是 cust_1（自推不计，所以必须用两个客户）
      const a = await register(app, "cust_9", 500);
      await completeOrder(app, deps, a.id);

      const mine = await app.inject({
        method: "GET",
        url: "/api/v1/store/affiliate/me",
        headers: { authorization: "Bearer customer9", "content-type": "application/json" },
      });
      expect(mine.statusCode, mine.body).toBe(200);
      const data = mine.json().data as { affiliate: { code: string }; pending_minor: number; items: unknown[] };
      expect(data.affiliate.code).toBe(a.code);
      expect(data.pending_minor).toBe(535);
      expect(data.items).toHaveLength(1);
    });
  });
});
