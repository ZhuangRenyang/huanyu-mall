import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 退货退款（ADR-051）：钱只在「商家确认收到货」那一步走。
 *
 * 这一条守的是资金安全：改造前商家点「同意」就立刻打款，
 * 货还没回来钱先出去，等于净亏一单 —— 而且是被自己的按钮亏掉的。
 *
 * 四个状态一路走完：pending → awaiting_return → returned → approved。
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

const admin = { authorization: "Bearer admin", "content-type": "application/json" };

/** 顾客提交一张退货退款申请（假订单 ord_1 可退）。 */
async function applyReturnRefund(
  app: Awaited<ReturnType<typeof buildApp>>,
  body: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/store/orders/ord_1/refund-requests",
    headers: { "content-type": "application/json" },
    payload: { reason: "尺码不对，想退回", resolution: "return_refund", ...body },
  });
}

describe("退货退款：同意不等于打款", () => {
  it("顾客申请带 resolution：申请单记下售后类型", async () => {
    await withApp(async (app) => {
      const res = await applyReturnRefund(app);
      expect(res.statusCode).toBe(201);
      expect(res.json().data.resolution).toBe("return_refund");
      expect(res.json().data.status).toBe("pending");
    });
  });

  it("不传 resolution 仍是仅退款（老前端不受影响）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: { "content-type": "application/json" },
        payload: { reason: "不想要了" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.resolution).toBe("refund_only");
    });
  });

  it("后台同意退货退款：只进「待买家退货」，**完全没有调退款工作流**", async () => {
    await withApp(async (app, deps) => {
      const created = await applyReturnRefund(app);
      const id = created.json().data.id;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: { note: "请寄回原包装" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("awaiting_return");
      expect(res.json().data.refund_id).toBeNull();
      // 最关键的一条：这一步不许碰钱
      expect(deps.state.lastWorkflowInput).toBeUndefined();
    });
  });

  it("仅退款仍走原路：同意即打款，工作流被执行", async () => {
    await withApp(async (app, deps) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: { "content-type": "application/json" },
        payload: { reason: "不想要了" },
      });
      const id = created.json().data.id;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("approved");
      // 打款跑过了（假 workflow 记下了入参）
      expect(deps.state.lastWorkflowInput?.orderId).toBe("ord_1");
    });
  });

  it("顾客填退货单号：进「待收货」，单号写回单据", async () => {
    await withApp(async (app) => {
      const created = await applyReturnRefund(app);
      const id = created.json().data.id;
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/store/refund-requests/${id}/return-shipment`,
        headers: { "content-type": "application/json" },
        payload: { carrier: "顺丰", tracking_number: "SF1234567890" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("returned");
      expect(res.json().data.return_carrier).toBe("顺丰");
      expect(res.json().data.return_tracking_number).toBe("SF1234567890");
    });
  });

  it("单号太短被拒（4 位起，防随手填 1 个字符）", async () => {
    await withApp(async (app) => {
      const created = await applyReturnRefund(app);
      const id = created.json().data.id;
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/store/refund-requests/${id}/return-shipment`,
        headers: { "content-type": "application/json" },
        payload: { carrier: "顺丰", tracking_number: "1" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("后台确认收货：这时才打款，单据转已同意", async () => {
    await withApp(async (app, deps) => {
      const created = await applyReturnRefund(app);
      const id = created.json().data.id;
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/store/refund-requests/${id}/return-shipment`,
        headers: { "content-type": "application/json" },
        payload: { carrier: "顺丰", tracking_number: "SF1234567890" },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/receive-return`,
        headers: admin,
        payload: { note: "已收到，包装完好" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("approved");
      expect(res.json().data.refund_id).toBe("rfd_1");
      // 钱是在这一步走的
      expect(deps.state.lastWorkflowInput?.orderId).toBe("ord_1");
    });
  });

  it("还没寄回就确认收货：409，且工作流不会跑（钱不动）", async () => {
    await withApp(async (app, deps) => {
      const created = await applyReturnRefund(app);
      const id = created.json().data.id;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/receive-return`,
        headers: admin,
        payload: {},
      });
      expect(res.statusCode).toBe(409);
      expect(deps.state.lastWorkflowInput).toBeUndefined();
    });
  });
});
