import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 取消订单并释放库存（ADR-075）。
 *
 * 两条线守同一件事：
 * 1. **取消必须把预留的库存还回去**。只改状态 = 这几件货永远挂在 reserved 上，
 *    顾客看到「有货」却下不了单 —— 这是看不见的库存泄漏，原来后台取消就是这样。
 * 2. 顾客只能取消**未付款**订单：付过款的必须走退款审核，
 *    否则等于绕过「商家审核」这道闸门。
 */
async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    deps: ReturnType<typeof makeDeps>,
  ) => Promise<void>,
) {
  const deps = makeDeps();
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
const customer = { authorization: "Bearer customer" };

describe("顾客取消未付款订单（ADR-075）", () => {
  it("未付款订单可取消，并把在占用的预留交给工作流释放", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderReservations = [
        { id: "rsv_1", status: "reserved" },
        { id: "rsv_2", status: "released" },
      ];
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/cancel",
        headers: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.status).toBe("canceled");

      // 只把「还在占用」的交给工作流；已释放的不重复处理
      const input = deps.state.lastWorkflowInput as { reservationIds?: string[] };
      expect(input.reservationIds).toEqual(["rsv_1"]);
    });
  });

  it("已付款订单不能直接取消（要退款审核，不能绕过）", async () => {
    await withApp(async (app, deps) => {
      // 假订单初始 pending；先「付款」再试着取消
      const orderService = deps.services.order as unknown as {
        updateStatus: (id: string, status: string) => Promise<void>;
      };
      await orderService.updateStatus("ord_1", "paid");
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/cancel",
        headers: customer,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("申请售后");
      // 状态没被改动
      const after = await deps.services.order.retrieveOrder("ord_1");
      expect(after.status).toBe("paid");
    });
  });

  it("重复取消 → 400，不重复跑释放", async () => {
    await withApp(async (app, deps) => {
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/cancel",
        headers: customer,
      });
      expect(first.statusCode, first.body).toBe(200);
      deps.state.lastWorkflowInput = undefined;

      const second = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/cancel",
        headers: customer,
      });
      expect(second.statusCode).toBe(400);
      expect(second.json().message).toContain("已经取消过");
      expect(deps.state.lastWorkflowInput).toBeUndefined();
    });
  });

  it("未登录 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "POST", url: "/api/v1/store/orders/ord_1/cancel" });
      expect(res.statusCode).toBe(401);
    });
  });
});

describe("后台取消订单也要释放库存（ADR-075）", () => {
  it("后台取消：状态转已取消，预留一并交给工作流", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderReservations = [{ id: "rsv_9", status: "reserved" }];
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/cancel",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.status).toBe("canceled");
      const input = deps.state.lastWorkflowInput as { reservationIds?: string[] };
      expect(input.reservationIds).toEqual(["rsv_9"]);
    });
  });
});
