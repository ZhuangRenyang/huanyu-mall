import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 退款管理（对齐淘宝「交易 → 退款管理」）。
 *
 * 守四件事：
 * 1. 顾客只能申请全额（金额由服务端按订单取，不能自己传）；
 * 2. 同意后单据要有资金流水号 —— 没有退款号的「已同意」等于没退钱；
 * 3. 拒绝必须写理由（顾客要看到为什么被拒）；
 * 4. 已处理的单据不能再处理一次（防双击重复退款）。
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

const adminJson = { authorization: "Bearer admin", "content-type": "application/json" };
const admin = { authorization: "Bearer admin" };

describe("退款管理", () => {
  it("顾客申请退款：落为待处理，金额取订单实付", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: { "content-type": "application/json" },
        payload: { reason: "不想要了" },
      });
      expect(res.statusCode, res.body).toBe(201);
      const data = res.json().data;
      expect(data.status).toBe("pending");
      expect(data.source).toBe("customer");
      expect(data.amount_minor).toBe(10700);
    });
  });

  it("后台列表能按状态筛出待处理", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: { "content-type": "application/json" },
        payload: { reason: "商品有瑕疵" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/refund-requests?status=pending",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.count).toBe(1);
      expect(res.json().data.items[0].reason).toBe("商品有瑕疵");
    });
  });

  it("同意退款：状态变已同意，且写入资金流水号", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: { "content-type": "application/json" },
        payload: { reason: "发错货" },
      });
      const id = created.json().data.id as string;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: adminJson,
        payload: {},
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.status).toBe("approved");
      // 没有退款号的「已同意」等于没退钱
      expect(data.refund_id).toBe("rfd_1");
    });
  });

  it("拒绝退款必须填理由（空理由被参数校验挡住）", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: { "content-type": "application/json" },
        payload: { reason: "不想要了" },
      });
      const id = created.json().data.id as string;

      const empty = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/reject`,
        headers: adminJson,
        payload: { note: "" },
      });
      expect(empty.statusCode).toBe(400);
    });
  });

  it("拒绝退款：状态变已拒绝并留下理由", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: { "content-type": "application/json" },
        payload: { reason: "不想要了" },
      });
      const id = created.json().data.id as string;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/reject`,
        headers: adminJson,
        payload: { note: "商品已发货，请收到后申请退货" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.status).toBe("rejected");
      expect(res.json().data.review_note).toContain("已发货");
    });
  });

  it("对已处理的申请再次同意 → 409（防双击重复退款）", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/store/orders/ord_1/refund-requests",
        headers: { "content-type": "application/json" },
        payload: { reason: "不想要了" },
      });
      const id = created.json().data.id as string;
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/reject`,
        headers: adminJson,
        payload: { note: "不同意" },
      });

      const again = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: adminJson,
        payload: {},
      });
      expect(again.statusCode).toBe(409);
    });
  });

  it("不存在的申请 → 404", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/refund-requests/rfr_missing/approve",
        headers: adminJson,
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

/**
 * 人工审核闸门（对齐淘宝）。
 *
 * 这里守的不是「接口能不能调」，而是**有没有绕过审核的路径**：
 * 订单详情直接退款、退款中照常发货 —— 任何一个漏了，人工审核就成了摆设。
 */
describe("退款必须人工审核", () => {
  it("订单详情发起退款：只建单不打款，订单转「退款中」", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/refunds",
        headers: adminJson,
        payload: { reason: "商品缺货，与顾客协商退款" },
      });
      expect(res.statusCode, res.body).toBe(201);
      const data = res.json().data;
      expect(data.refund.status).toBe("pending");
      // 关键：没打款。有 refund_id 才说明钱动了
      expect(data.refund.refund_id).toBeNull();
      // 订单被冻结，避免审核期间继续发货
      expect(data.order.status).toBe("refund_pending");
    });
  });

  it("退款审核中禁止发货（货发了钱也退了，就是资损）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/refunds",
        headers: adminJson,
        payload: { reason: "不想要了" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/fulfillments",
        headers: adminJson,
        payload: {
          items: [{ order_line_item_id: "oli_1", quantity: 1 }],
        },
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().message).toContain("退款");
    });
  });

  it("退款审核中禁止填运单号（发货单可能早就建好了）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/refunds",
        headers: adminJson,
        payload: { reason: "不想要了" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/fulfillments/fulf_1/shipments",
        headers: adminJson,
        payload: { carrier_name: "顺丰", tracking_number: "SF123" },
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().message).toContain("退款");
    });
  });

  it("同意退款后订单变「已退款」，单据带资金流水号", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/refunds",
        headers: adminJson,
        payload: { reason: "不想要了" },
      });
      const id = created.json().data.refund.id as string;

      const approved = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: adminJson,
        payload: {},
      });
      expect(approved.statusCode, approved.body).toBe(200);
      expect(approved.json().data.refund_id).toBe("rfd_1");

      const order = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders/ord_1",
        headers: admin,
      });
      expect(order.json().data.status).toBe("refunded");
    });
  });

  it("退款列表带各状态计数（页签角标不用前端自己数）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/refunds",
        headers: adminJson,
        payload: { reason: "不想要了" },
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/refund-requests?status=pending",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.counts.pending).toBe(1);
      expect(res.json().data.counts.all).toBe(1);
    });
  });

  it("客户端传的金额会被忽略：退款额一律取订单实付", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/refunds",
        headers: adminJson,
        // 想只退 1 分：schema 会剥掉这个字段，落库金额仍应是订单实付 10700
        payload: { reason: "不想要了", amount_minor: 1 },
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().data.refund.amount_minor).toBe(10700);
    });
  });
});
