import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { PaymentService } from "../src/services/payment.service.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";

function setup(configs: Record<string, Record<string, unknown>> = {}) {
  const repo = new InMemoryPaymentRepository();
  const registry = new ProviderRegistry();
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  const service = new PaymentService({
    repo,
    registry,
    resolveProviderConfig: async (id) => configs[id] ?? {},
    emit: async (event) => {
      events.push(event);
    },
  });
  return { repo, service, events };
}

describe("PaymentService（M06，Fake 闭环 + 幂等 + webhook 去重）", () => {
  it("Fake 全流程：建集合 → 建会话 → 授权 → 扣款", async () => {
    const { service } = setup();
    const collection = await service.createPaymentCollection({ currencyCode: "CNY", amountMinor: 10000n });
    const session = await service.createSession({ paymentCollectionId: collection.id, providerId: "pp_fake" });
    expect(session.context?.kind).toBe("qrcode");

    const payment = await service.authorizeSession(session.id);
    expect(payment.status).toBe("authorized");

    const captured = await service.capturePayment(payment.id, 10000n, "cap-1");
    expect(captured.status).toBe("captured");
    expect(captured.captured_at).not.toBeNull();
  });

  it("退款幂等：同 idempotencyKey 只落一笔", async () => {
    const { repo, service } = setup();
    const collection = await service.createPaymentCollection({ currencyCode: "CNY", amountMinor: 10000n });
    const session = await service.createSession({ paymentCollectionId: collection.id, providerId: "pp_fake" });
    const payment = await service.authorizeSession(session.id);
    await service.capturePayment(payment.id, 10000n, "cap-1");

    const r1 = await service.refundPayment({ paymentId: payment.id, amountMinor: 10000n, reason: "x", idempotencyKey: "ref-1" });
    const r2 = await service.refundPayment({ paymentId: payment.id, amountMinor: 10000n, reason: "x", idempotencyKey: "ref-1" });
    expect(r2.id).toBe(r1.id);
    expect(repo.refunds.size).toBe(1);
  });

  it("webhook 重复投递只处理一次（唯一去重）", async () => {
    const { repo, service } = setup();
    const collection = await service.createPaymentCollection({ currencyCode: "CNY", amountMinor: 10000n });
    const session = await service.createSession({ paymentCollectionId: collection.id, providerId: "pp_fake" });
    const payment = await service.authorizeSession(session.id);

    const body = JSON.stringify({ id: "evt_1", event: "captured", paymentId: payment.id, amountMinor: 10000 });
    const r1 = await service.handleProviderWebhook("pp_fake", { headers: {}, rawBody: body });
    expect(r1.duplicate).toBe(false);
    const r2 = await service.handleProviderWebhook("pp_fake", { headers: {}, rawBody: body });
    expect(r2.duplicate).toBe(true);
    expect(repo.webhookEventCount).toBe(1);
    expect(repo.payments.get(payment.id)?.status).toBe("captured");
  });

  it("回调只带支付商交易号时，靠商户单号（sessionId）反查定位支付单", async () => {
    /*
     * 真实场景：支付商回传的 `paymentId` 是**支付商侧交易号**（支付宝 trade_no、
     * PayPal capture id），与我们内部的 payment.id（pay_xxx）不在同一 ID 空间。
     * 早先的实现直接拿它 updatePaymentStatus → 更新不到任何行，
     * 症状是「回调 200、审计表有记录，但订单永远停在 pending/unpaid」，极难察觉。
     * 可靠锚点是商户单号：发起支付时传给支付商的 collection.id，回调原样带回。
     */
    const { repo, service } = setup();
    const collection = await service.createPaymentCollection({
      orderId: "ord_pp_1",
      currencyCode: "CNY",
      amountMinor: 20600n,
    });
    const session = await service.createSession({ paymentCollectionId: collection.id, providerId: "pp_fake" });
    const payment = await service.authorizeSession(session.id);

    const body = JSON.stringify({
      id: "evt_pp_1",
      event: "captured",
      paymentId: "TRADE_NO_FROM_ALIPAY", // 支付商侧交易号（内部查不到）
      sessionId: collection.id, // 商户单号（= collection.id，回调原样带回）
      amountMinor: 20600,
    });
    const r = await service.handleProviderWebhook("pp_fake", { headers: {}, rawBody: body });
    expect(r.duplicate).toBe(false);
    expect(repo.payments.get(payment.id)?.status).toBe("captured");
  });

  it("回调先于授权到达（还没有 payment 记录）→ 按商户单号补建支付单并置为已支付", async () => {
    /*
     * 支付宝/PayPal 是「付款即成功」：授权阶段只查单确认、不创建支付单，
     * 支付单是在 authorizeSession 授权成功后才创建的。时序上用户完全可能先付款、
     * 回调先到 —— 这时回调里没有任何 payment 记录可更新。
     */
    const { repo, service } = setup();
    const collection = await service.createPaymentCollection({
      orderId: "ord_pp_2",
      currencyCode: "CNY",
      amountMinor: 20600n,
    });
    // 故意不调 createSession / authorizeSession：模拟"用户先付款、回调先到"
    const body = JSON.stringify({
      id: "evt_pp_3",
      event: "captured",
      paymentId: "TRADE_NO_FROM_ALIPAY",
      sessionId: collection.id,
      amountMinor: 20600,
    });
    const r = await service.handleProviderWebhook("pp_fake", { headers: {}, rawBody: body });
    expect(r.duplicate).toBe(false);
    const payment = await repo.findPaymentByCollectionId(collection.id);
    expect(payment?.status).toBe("captured");
    expect(payment?.amount_minor).toBe(20600n);
  });

  it("商户单号对不上（支付集合都找不到）→ 抛错（不静默放过，否则订单永远停在 unpaid）", async () => {
    const { service } = setup();
    const body = JSON.stringify({
      id: "evt_pp_2",
      event: "captured",
      paymentId: "UNKNOWN_TRADE_NO",
      sessionId: "UNKNOWN_COLLECTION_ID",
      amountMinor: 100,
    });
    await expect(service.handleProviderWebhook("pp_fake", { headers: {}, rawBody: body })).rejects.toThrow(
      /无法定位支付集合/,
    );
  });

  it("验签失败 → 401（DomainError 40005）且不落库", async () => {
    const { repo, service } = setup({ pp_stripe: { webhookSecret: "whsec_test" } });
    const body = JSON.stringify({
      id: "evt_x",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", amount: 1000 } },
    });
    await expect(
      service.handleProviderWebhook("pp_stripe", {
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        rawBody: body,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(repo.webhookEventCount).toBe(0);
  });

  it("listEnabledProviders 按渠道返回启用列表", async () => {
    const { repo, service } = setup();
    repo.channelProviders.set("chn_cn", ["pp_wechat", "pp_alipay"]);
    const list = await service.listEnabledProviders("chn_cn");
    expect(list.map((p) => p.identifier)).toEqual(["pp_wechat", "pp_alipay"]);
    expect(list[0]?.capabilities.qrFlow).toBe(true);
  });

  // 真机问题 #30：走 capture API 扣款时，payment.captured 事件必须带 orderId，
  // 否则 subscriber 直接 return → 订单永远停在 pending/unpaid。
  it("capture 事件带 orderId（从集合反查）——订单才能自动转正", async () => {
    const { service, events } = setup();
    const collection = await service.createPaymentCollection({
      orderId: "ord_test_1",
      currencyCode: "CNY",
      amountMinor: 20600n,
    });
    const session = await service.createSession({ paymentCollectionId: collection.id, providerId: "pp_fake" });
    const payment = await service.authorizeSession(session.id);
    await service.capturePayment(payment.id, 20600n, "cap-order");

    const captured = events.find((e) => e.name === "payment.captured");
    expect(captured).toBeDefined();
    expect(captured?.data.orderId).toBe("ord_test_1");
    expect(captured?.data.amountMinor).toBe(20600);
  });

  it("集合无 orderId 时事件 orderId 为 null（不伪造）", async () => {
    const { service, events } = setup();
    const collection = await service.createPaymentCollection({ currencyCode: "CNY", amountMinor: 100n });
    const session = await service.createSession({ paymentCollectionId: collection.id, providerId: "pp_fake" });
    const payment = await service.authorizeSession(session.id);
    await service.capturePayment(payment.id, 100n, "cap-no-order");

    const captured = events.find((e) => e.name === "payment.captured");
    expect(captured?.data.orderId).toBeNull();
  });

  it("capture 未指定金额时兜底取支付记录金额（不再记 0）", async () => {
    const { repo, service, events } = setup();
    const collection = await service.createPaymentCollection({
      orderId: "ord_test_2",
      currencyCode: "CNY",
      amountMinor: 20600n,
    });
    const session = await service.createSession({ paymentCollectionId: collection.id, providerId: "pp_fake" });
    const payment = await service.authorizeSession(session.id);
    await service.capturePayment(payment.id, 0n, "cap-amount");

    expect(repo.transactions.at(-1)?.amountMinor).toBe(20600n);
    expect(events.find((e) => e.name === "payment.captured")?.data.amountMinor).toBe(20600);
  });

  it("findCollectionByOrderId 能反查集合", async () => {
    const { service } = setup();
    const collection = await service.createPaymentCollection({
      orderId: "ord_find_1",
      currencyCode: "CNY",
      amountMinor: 100n,
    });
    const found = await service.findCollectionByOrderId("ord_find_1");
    expect(found?.id).toBe(collection.id);
    expect(await service.findCollectionByOrderId("ord_not_exist")).toBeNull();
  });
});
