import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 订单列表的售后进度角标（ADR-073）。
 *
 * 原来列表只按订单状态写「退款中」：商家分不清「该我审」「等买家寄回」「已寄回待收货」，
 * 三件事的动作完全不同，只能逐单点开看。
 *
 * 这里守：每单挂最近一张**在途**售后单的档位；处理完（同意/拒绝）就摘掉角标。
 */
async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    deps: ReturnType<typeof makeDeps>,
  ) => Promise<void>,
) {
  const deps = makeDeps();
  // 假服务默认「没下过单就是空列表」；这里要验列表上的角标，先让订单存在
  deps.state.orderCreated = true;
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const admin = { authorization: "Bearer admin", "content-type": "application/json" };
const json = { "content-type": "application/json" };

async function listOrderRow(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders", headers: admin });
  expect(res.statusCode, res.body).toBe(200);
  const items = res.json().data.items as Array<{
    id: string;
    refund?: { id: string; status: string; resolution: string } | null;
  }>;
  const row = items.find((o) => o.id === "ord_1");
  expect(row, "订单没出现在列表里，角标无从谈起").toBeTruthy();
  return row;
}

async function applyRefund(
  app: Awaited<ReturnType<typeof buildApp>>,
  resolution: "return_refund" | undefined,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/store/orders/ord_1/refund-requests",
    headers: json,
    payload: { reason: "尺码不对", ...(resolution ? { resolution } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data.id as string;
}

describe("订单列表售后进度（ADR-073）", () => {
  it("没有售后单 → refund 为 null，列表不挂角标", async () => {
    await withApp(async (app) => {
      const row = await listOrderRow(app);
      expect(row?.refund ?? null).toBeNull();
    });
  });

  it("顾客申请后 → pending（待商家审核）", async () => {
    await withApp(async (app) => {
      const id = await applyRefund(app, undefined);
      const row = await listOrderRow(app);
      expect(row?.refund?.id).toBe(id);
      expect(row?.refund?.status).toBe("pending");
      expect(row?.refund?.resolution).toBe("refund_only");
    });
  });

  it("同意退货 → awaiting_return；填了退货单号 → returned", async () => {
    await withApp(async (app) => {
      const id = await applyRefund(app, "return_refund");
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      expect((await listOrderRow(app))?.refund?.status).toBe("awaiting_return");

      await app.inject({
        method: "POST",
        url: `/api/v1/store/refund-requests/${id}/return-shipment`,
        headers: json,
        payload: { carrier: "顺丰", tracking_number: "SF1234567890" },
      });
      expect((await listOrderRow(app))?.refund?.status).toBe("returned");
    });
  });

  it("处理完（拒绝）→ 角标摘掉，不留在列表上误导商家", async () => {
    await withApp(async (app) => {
      const id = await applyRefund(app, undefined);
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/reject`,
        headers: admin,
        payload: { note: "商品已使用" },
      });
      const row = await listOrderRow(app);
      expect(row?.refund ?? null).toBeNull();
    });
  });
});
