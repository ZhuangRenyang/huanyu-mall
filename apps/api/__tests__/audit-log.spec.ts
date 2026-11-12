import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

async function withApp(
  fn: (app: Awaited<ReturnType<typeof buildApp>>, deps: ReturnType<typeof makeDeps>) => Promise<void>,
): Promise<void> {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const adminHeaders = { authorization: "Bearer admin", "content-type": "application/json" };
/** 无请求体的写操作：不能带 content-type，否则 Fastify 会按空 JSON 解析报 400。 */
const adminAuthOnly = { authorization: "Bearer admin" };

describe("审计日志（Phase 4）", () => {
  it("1. 后台创建商品写入一条审计记录（动作/实体/操作者齐全）", async () => {
    await withApp(async (app, deps) => {
      expect(deps.auditRepo.rows).toHaveLength(0);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: adminHeaders,
        payload: { title: "新品", handle: "new-product" },
        remoteAddress: "203.0.113.77",
      });
      expect(res.statusCode).toBe(201);

      const rows = deps.auditRepo.rows;
      expect(rows).toHaveLength(1);
      const entry = rows[0]!;
      expect(entry.action).toBe("product.create");
      expect(entry.entityType).toBe("product");
      expect(entry.entityId).toBe("prod_1");
      expect(entry.actorType).toBe("admin");
      expect(entry.actorId).toBe("adm_1");
      expect(entry.ip).toBe("203.0.113.77");
      expect(entry.requestId).toBeTruthy();
      expect((entry.after as { handle: string }).handle).toBe("new-product");
    });
  });

  it("2. 查询端点能按 action 过滤", async () => {
    await withApp(async (app, deps) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: adminHeaders,
        payload: { title: "新品", handle: "new-product" },
      });
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminHeaders,
        payload: { primary_color: "#101010" },
      });

      const all = await app.inject({
        method: "GET",
        url: "/api/v1/admin/audit-logs?limit=50",
        headers: { authorization: "Bearer admin" },
      });
      expect(all.statusCode).toBe(200);
      expect(all.json().data.count).toBe(2);

      const filtered = await app.inject({
        method: "GET",
        url: "/api/v1/admin/audit-logs?action=theme.update",
        headers: { authorization: "Bearer admin" },
      });
      expect(filtered.statusCode).toBe(200);
      expect(filtered.json().data.count).toBe(1);
      expect(filtered.json().data.items[0].action).toBe("theme.update");
      expect(filtered.json().data.items[0].entity_type).toBe("theme");
    });
  });

  it("3. 查询端点支持按实体类型过滤，且 staff 无权查看审计", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: adminHeaders,
        payload: { title: "新品", handle: "new-product" },
      });

      const byEntity = await app.inject({
        method: "GET",
        url: "/api/v1/admin/audit-logs?entity_type=product",
        headers: { authorization: "Bearer admin" },
      });
      expect(byEntity.json().data.count).toBe(1);
      expect(byEntity.json().data.items[0].entity_type).toBe("product");

      const staff = await app.inject({
        method: "GET",
        url: "/api/v1/admin/audit-logs",
        headers: { authorization: "Bearer staff" },
      });
      expect(staff.statusCode).toBe(403);

      const anonymous = await app.inject({ method: "GET", url: "/api/v1/admin/audit-logs" });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  it("4. 审计写失败不阻塞主流程：商品仍创建成功", async () => {
    await withApp(async (app, deps) => {
      deps.auditRepo.failNextInsert = true;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: adminHeaders,
        payload: { title: "新品", handle: "new-product" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.handle).toBe("new-product");
      // 故障被吞掉，没有落库，但业务请求没挂
      expect(deps.auditRepo.rows).toHaveLength(0);
    });
  });

  it("5. 订单流转/退款/发货/支付商配置/支付扣款均留痕", async () => {
    await withApp(async (app, deps) => {
      await app.inject({ method: "POST", url: "/api/v1/admin/orders/ord_1/cancel", headers: adminAuthOnly });
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/refunds",
        headers: adminHeaders,
        payload: { amount_minor: 10700, reason: "客户申请退款" },
      });
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/fulfillments/fulf_1/shipments",
        headers: adminHeaders,
        payload: { carrier_name: "顺丰", tracking_number: "SF1234567" },
      });
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/payment-providers/pp_wechat",
        headers: adminHeaders,
        payload: { options: { mchid: "1912345678", apiV3Key: "wechat-test-key-aaaaaaaaaaaaaaaa" } },
      });
      await app.inject({
        method: "POST",
        url: "/api/v1/store/payment-sessions",
        headers: { "content-type": "application/json", "x-publishable-key": "cn" },
        payload: { cart_id: "cart_1", provider_id: "pp_fake" },
      });
      await app.inject({
        method: "POST",
        url: "/api/v1/store/payments/pay_1/capture",
        headers: { "content-type": "application/json", "x-publishable-key": "cn" },
        payload: { amount_minor: 19800, idempotency_key: "cap_audit_1" },
      });

      const actions = deps.auditRepo.rows.map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "order.cancel",
          "order.refund",
          "shipment.create",
          "payment_provider.configure",
          "payment_session.create",
          "payment.capture",
        ]),
      );

      // 支付商配置落库的是掩码视图，明文密钥不进审计表
      const providerAudit = deps.auditRepo.rows.find((r) => r.action === "payment_provider.configure")!;
      const after = JSON.stringify(providerAudit.after ?? {});
      expect(after).not.toContain("wechat-test-key-aaaaaaaaaaaaaaaa");
      expect(after).toContain("****aaaa");
    });
  });

  it("6. 支付回调记为 system 操作者（不是访客）", async () => {
    await withApp(async (app, deps) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/webhooks/payment/pp_stripe",
        headers: { "stripe-signature": "valid", "content-type": "application/json" },
        payload: JSON.stringify({ id: "evt_audit_1" }),
      });
      expect(res.statusCode).toBe(200);
      const entry = deps.auditRepo.rows.find((r) => r.action === "payment.webhook")!;
      expect(entry.actorType).toBe("system");
    });
  });
});
