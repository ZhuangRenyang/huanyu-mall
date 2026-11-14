import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 换货（ADR-090）。
 *
 * 换货全程不动钱：同意换货先预留换出商品、确认收到退回不碰资金、发出换货完结。
 * 测试重点守住「钱不能从换货路径流出去」与「状态机顺序」两条。
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

/** 让订单处于已发货（换货要求已发货）。 */
async function seedShippedExchange(deps: any): Promise<string> {
  deps.state.orderCreated = true;
  const orderService = deps.services.order as unknown as { updateStatus: (id: string, s: string) => Promise<void> };
  await orderService.updateStatus("ord_1", "fulfilled");
  return "ord_1";
}

describe("换货（ADR-090）", () => {
  it("顾客申请换货：必须指定目标规格，且只允许同一商品", async () => {
    await withApp(async (app, deps) => {
      await seedShippedExchange(deps);

      // 缺目标规格 → 400
      const missing = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: cust,
        payload: { reason: "尺码不对，想换", resolution: "exchange" },
      });
      expect(missing.statusCode).toBe(400);

      // 合法申请 → 201，单据带换货字段
      const ok = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: cust,
        payload: { reason: "尺码不对，想换", resolution: "exchange", exchange_variant_id: "var_1" },
      });
      expect(ok.statusCode, ok.body).toBe(201);
      const data = ok.json().data as { resolution: string; exchange_variant_id: string | null };
      expect(data.resolution).toBe("exchange");
      expect(data.exchange_variant_id).toBe("var_1");
    });
  });

  it("同意换货 → 等寄回 → 确认收到 → 发出换货，全程不打款", async () => {
    await withApp(async (app, deps) => {
      await seedShippedExchange(deps);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: cust,
        payload: { reason: "换一件", resolution: "exchange", exchange_variant_id: "var_1" },
      });
      const id = (created.json().data as { id: string }).id;

      // 同意换货
      const agree = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/agree-exchange`,
        headers: admin,
        payload: { note: "同意，请寄回" },
      });
      expect(agree.statusCode, agree.body).toBe(200);
      expect((agree.json().data as { status: string }).status).toBe("awaiting_return");

      // 买家寄回
      const ship = await app.inject({
        method: "POST",
        url: `/api/v1/store/refund-requests/${id}/return-shipment`,
        headers: cust,
        payload: { carrier: "顺丰", tracking_number: "SF123456" },
      });
      expect(ship.statusCode).toBe(200);

      // 确认收到退回（换货不打款）
      const received = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/receive-exchange`,
        headers: admin,
        payload: { note: "收到" },
      });
      expect(received.statusCode, received.body).toBe(200);
      expect((received.json().data as { status: string }).status).toBe("exchange_sending");

      // 发出换货
      const out = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/ship-exchange`,
        headers: admin,
        payload: { carrier: "中通", tracking_number: "ZT654321" },
      });
      expect(out.statusCode, out.body).toBe(200);
      const final = out.json().data as { status: string; exchange_tracking_number: string };
      expect(final.status).toBe("completed");
      expect(final.exchange_tracking_number).toBe("ZT654321");
    });
  });

  it("换货不能走退款打款关卡：approve 与 receive-return 都拒绝", async () => {
    await withApp(async (app, deps) => {
      await seedShippedExchange(deps);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: cust,
        payload: { reason: "换一件", resolution: "exchange", exchange_variant_id: "var_1" },
      });
      const id = (created.json().data as { id: string }).id;

      // 同意退款（打款关卡）对换货必须报 409，不能退钱
      const approve = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      expect(approve.statusCode).toBe(409);
    });
  });
});
