import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 退款进度通知（ADR-072）。
 *
 * 顾客提了售后，商家点同意或拒绝之后必须有回音 —— 他不看后台，
 * 只看邮箱和「我的订单」。这里守三件事：
 * 1. 同意 / 拒绝 / 收到退货三个节点都入队；
 * 2. 「同意退货」与「已退款」是两封（去重键带档位，不是一封覆盖一封）；
 * 3. 邮件开关关掉就一封都不发。
 *
 * 发信本身在 notification 模块单测里验；这里只验「该发的时候有没有入队、发给谁」。
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
const json = { "content-type": "application/json" };

/** 打开邮件总开关（默认关着：没配 SMTP 的店铺不该往外出信）。 */
async function enableMail(deps: ReturnType<typeof makeDeps>) {
  await deps.services.notification.updateSettings({
    enabled: true,
    from_email: "shop@example.com",
    smtp_host: "smtp.example.com",
  });
}

/** 取全部通知记录（假服务的 list 直接返回内部行）。 */
async function mailRows(deps: ReturnType<typeof makeDeps>) {
  const res = await deps.services.notification.list({ limit: 50, offset: 0 });
  return res.items as Array<{
    template: string;
    to_email: string;
    subject: string;
    order_id: string | null;
    dedupe_key?: string;
  }>;
}

async function applyRefund(
  app: Awaited<ReturnType<typeof buildApp>>,
  resolution?: "return_refund",
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/store/orders/ord_1/refund-requests",
    headers: json,
    payload: { reason: "不想要了", ...(resolution ? { resolution } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data.id as string;
}

describe("退款进度通知（ADR-072）", () => {
  it("仅退款同意 → 入队「退款已原路退回」，发给下单邮箱", async () => {
    await withApp(async (app, deps) => {
      await enableMail(deps);
      const id = await applyRefund(app);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      expect(res.statusCode, res.body).toBe(200);

      const mails = (await mailRows(deps)).filter((m) => m.template === "refund_update");
      expect(mails).toHaveLength(1);
      expect(mails[0]?.to_email).toBe("a@b.com");
      expect(mails[0]?.subject).toContain("退款已原路退回");
    });
  });

  it("拒绝 → 入队「退款申请未通过」，带拒绝档位的去重键", async () => {
    await withApp(async (app, deps) => {
      await enableMail(deps);
      const id = await applyRefund(app);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/reject`,
        headers: admin,
        payload: { note: "商品已使用" },
      });
      expect(res.statusCode, res.body).toBe(200);

      const mails = (await mailRows(deps)).filter((m) => m.template === "refund_update");
      expect(mails).toHaveLength(1);
      expect(mails[0]?.subject).toContain("退款申请未通过");
      expect(mails[0]?.dedupe_key).toBe(`refund:${id}:rejected`);
    });
  });

  it("退货退款：同意寄回一封、收到货再一封（两封不互相覆盖）", async () => {
    await withApp(async (app, deps) => {
      await enableMail(deps);
      const id = await applyRefund(app, "return_refund");

      const agreed = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: { note: "请寄回原包装" },
      });
      expect(agreed.statusCode, agreed.body).toBe(200);

      await app.inject({
        method: "POST",
        url: `/api/v1/store/refund-requests/${id}/return-shipment`,
        headers: json,
        payload: { carrier: "顺丰", tracking_number: "SF1234567890" },
      });
      const received = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/receive-return`,
        headers: admin,
        payload: {},
      });
      expect(received.statusCode, received.body).toBe(200);

      const mails = (await mailRows(deps)).filter((m) => m.template === "refund_update");
      expect(mails).toHaveLength(2);
      expect(mails.map((m) => m.subject).sort()).toEqual([
        "退款已原路退回：订单 ord_1",
        "退货申请已同意：订单 ord_1",
      ]);
    });
  });

  it("邮件总开关关着 → 一封都不入队（不制造发不出去的待办）", async () => {
    await withApp(async (app, deps) => {
      const id = await applyRefund(app);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/refund-requests/${id}/approve`,
        headers: admin,
        payload: {},
      });
      expect(res.statusCode, res.body).toBe(200);

      const mails = (await mailRows(deps)).filter((m) => m.template === "refund_update");
      expect(mails).toHaveLength(0);
    });
  });
});
