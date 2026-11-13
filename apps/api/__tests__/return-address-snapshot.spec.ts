import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 退货地址快照（ADR-061）。
 *
 * ADR-053 把退货地址做成店铺配置（一处改、处处生效），但那是**实时读取**：
 * 商家今天改地址，昨天已同意退货的顾客刷新页面就变成新地址 ——
 * 而他手上的包裹可能已经按旧地址寄出了，两边永远对不上，包裹在两个地址之间消失。
 *
 * 所以地址必须在「同意退货」那一刻快照进单据。这里守三件事：
 * 1. 同意时就记下当时的地址，顾客能看到；
 * 2. 商家之后改店铺地址，这一单**不变**；
 * 3. 没配地址也能同意（否则退款永远卡在待处理），快照为 null。
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
const customer = { authorization: "Bearer customer", "content-type": "application/json" };

const OLD_ADDR = "收件人：张三\n电话：13800000000\n地址：广东省深圳市南山区科苑路 15 号 3 号仓";
const NEW_ADDR = "收件人：李四\n电话：13900000000\n地址：广东省东莞市松山湖 8 号新仓";

/** 改店铺退货地址（走真实设置接口，口径与后台一致）。 */
async function setReturnAddress(app: Awaited<ReturnType<typeof buildApp>>, addr: string) {
  const res = await app.inject({
    method: "PATCH",
    url: "/api/v1/admin/settings",
    headers: admin,
    payload: { return_address: addr },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** 顾客提一张退货退款申请，返回单据 id。 */
async function applyReturnRefund(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/store/orders/ord_1/refund-requests",
    headers: customer,
    payload: { reason: "尺码不对，想退回", resolution: "return_refund" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data.id as string;
}

/** 读这一单的售后单据（顾客视角）。 */
async function listRefunds(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/store/orders/ord_1/refund-requests",
    headers: customer,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data.items as Array<Record<string, unknown>>;
}

describe("退货地址快照", () => {
  it("同意退货时把店铺地址记进单据，顾客能看到", async () => {
    await withApp(async (app) => {
      await setReturnAddress(app, OLD_ADDR);
      const id = await applyReturnRefund(app);

      const approve = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      expect(approve.statusCode, approve.body).toBe(200);
      expect(approve.json().data.return_address).toBe(OLD_ADDR);

      const [row] = await listRefunds(app);
      expect(row?.return_address).toBe(OLD_ADDR);
    });
  });

  it("商家之后改店铺地址，已同意的那一单**不变**（最关键的一条）", async () => {
    await withApp(async (app) => {
      await setReturnAddress(app, OLD_ADDR);
      const id = await applyReturnRefund(app);
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });

      // 商家搬仓，把地址改掉
      await setReturnAddress(app, NEW_ADDR);

      const [row] = await listRefunds(app);
      // 顾客照旧看到当初被告知的地址 —— 他的包裹已经按这个寄出了
      expect(row?.return_address).toBe(OLD_ADDR);
      expect(row?.return_address).not.toBe(NEW_ADDR);
    });
  });

  it("没配退货地址也能同意退货，快照为 null（不把单据卡死）", async () => {
    await withApp(async (app) => {
      const id = await applyReturnRefund(app);
      const approve = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      // 同意退货不该因为「地址没填」而失败：那是商家漏配，不该拦住顾客退钱
      expect(approve.statusCode, approve.body).toBe(200);
      expect(approve.json().data.status).toBe("awaiting_return");
      expect(approve.json().data.return_address).toBeNull();
    });
  });

  it("仅退款不写地址（没货要寄，记了反而误导）", async () => {
    await withApp(async (app) => {
      await setReturnAddress(app, OLD_ADDR);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: customer,
        payload: { reason: "不想要了" },
      });
      const id = created.json().data.id as string;
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });

      const [row] = await listRefunds(app);
      expect(row?.resolution).toBe("refund_only");
      expect(row?.return_address).toBeNull();
    });
  });
});
