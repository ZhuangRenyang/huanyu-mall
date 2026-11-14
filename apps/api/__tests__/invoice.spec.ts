import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 发票（ADR-098）：手工登记版。
 *
 * 守住三条：
 *  1. 只有已收款订单能开票（未收款开票，退款时票要红冲）；
 *  2. 一张订单只能申请一次（否则会开出两张，账对不上）；
 *  3. 后台开票只登记发票号，不动钱、不动订单状态。
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
const admin = { authorization: "Bearer admin", "content-type": "application/json" };

/** 已收款、属于 cust_1 的订单。 */
function seedPaid(deps: any): void {
  deps.state.orderCreated = true;
  deps.state.orderCustomerId = "cust_1";
  deps.state.orderPaymentStatus = "captured";
}

describe("发票（ADR-098）", () => {
  it("顾客申请开票：金额取订单总额，企业缺税号被拒", async () => {
    await withApp(async (app, deps) => {
      seedPaid(deps);

      // 个人：只填抬头
      const personal = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/invoice",
        headers: cust,
        payload: { type: "personal", title: "张三" },
      });
      expect(personal.statusCode, personal.body).toBe(201);
      const data = personal.json().data as {
        status: string;
        amount_minor: string | number;
        email: string;
        type: string;
      };
      expect(data.status).toBe("pending");
      expect(data.type).toBe("personal");
      // 金额不接受客户端传值，取订单总额（假订单 10700）
      expect(Number(data.amount_minor)).toBe(10700);

      // 重复申请 → 409（一张订单只能一张票）
      const again = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/invoice",
        headers: cust,
        payload: { type: "personal", title: "张三" },
      });
      expect(again.statusCode).toBe(409);
    });
  });

  it("企业发票缺税号 → 400；补上税号才能提交", async () => {
    await withApp(async (app, deps) => {
      seedPaid(deps);
      const missing = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/invoice",
        headers: cust,
        payload: { type: "company", title: "某某科技有限公司" },
      });
      expect(missing.statusCode).toBe(400);

      const ok = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/invoice",
        headers: cust,
        payload: { type: "company", title: "某某科技有限公司", tax_id: "91310000MA1K3XYZ12" },
      });
      expect(ok.statusCode, ok.body).toBe(201);
      expect((ok.json().data as { tax_id: string }).tax_id).toBe("91310000MA1K3XYZ12");
    });
  });

  it("未收款订单不能开票", async () => {
    await withApp(async (app, deps) => {
      deps.state.orderCreated = true;
      deps.state.orderCustomerId = "cust_1";
      // 不设 orderPaymentStatus → 假订单默认 unpaid
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/invoice",
        headers: cust,
        payload: { type: "personal", title: "张三" },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  it("后台登记开票 → issued；重复开票被拒；拒绝开票写原因", async () => {
    await withApp(async (app, deps) => {
      seedPaid(deps);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/invoice",
        headers: cust,
        payload: { type: "personal", title: "张三" },
      });
      const id = (created.json().data as { id: string }).id;

      // 列表：待开票 1 张
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/invoices?status=pending",
        headers: admin,
      });
      expect(list.statusCode, list.body).toBe(200);
      const listed = list.json().data as { count: number; counts: { pending: number } };
      expect(listed.count).toBe(1);
      expect(listed.counts.pending).toBe(1);

      // 登记发票号
      const issued = await app.inject({
        method: "POST",
        url: `/api/v1/admin/invoices/${id}/issue`,
        headers: admin,
        payload: { invoice_no: "044001900111" },
      });
      expect(issued.statusCode, issued.body).toBe(200);
      const issuedData = issued.json().data as { status: string; invoice_no: string; issued_at: string };
      expect(issuedData.status).toBe("issued");
      expect(issuedData.invoice_no).toBe("044001900111");
      expect(issuedData.issued_at).not.toBeNull();

      // 重复开票 → 409（不能改号，红冲换开属线下流程）
      const again = await app.inject({
        method: "POST",
        url: `/api/v1/admin/invoices/${id}/issue`,
        headers: admin,
        payload: { invoice_no: "9999999" },
      });
      expect(again.statusCode).toBe(409);
    });
  });

  it("拒绝开票：原因必填，拒绝后顾客能看到原因", async () => {
    await withApp(async (app, deps) => {
      seedPaid(deps);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/invoice",
        headers: cust,
        payload: { type: "personal", title: "张三" },
      });
      const id = (created.json().data as { id: string }).id;

      const rejected = await app.inject({
        method: "POST",
        url: `/api/v1/admin/invoices/${id}/reject`,
        headers: admin,
        payload: { note: "抬头与付款人不一致" },
      });
      expect(rejected.statusCode, rejected.body).toBe(200);
      expect((rejected.json().data as { status: string }).status).toBe("rejected");

      // 顾客查进度：能看到拒绝原因
      const mine = await app.inject({
        method: "GET",
        url: "/api/v1/store/orders/ord_1/invoice",
        headers: cust,
      });
      expect(mine.statusCode).toBe(200);
      const view = mine.json().data as { status: string; review_note: string };
      expect(view.status).toBe("rejected");
      expect(view.review_note).toBe("抬头与付款人不一致");
    });
  });
});
