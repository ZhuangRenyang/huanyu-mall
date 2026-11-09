import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { resolveChannelId } from "../../plugins/auth.js";
import { getRawBody } from "../../app.js";
import { auditEntry } from "../audit-context.js";

const createSessionBody = z.object({
  payment_collection_id: z.string().optional(),
  cart_id: z.string().optional(),
  provider_id: z.string(),
});

/** 扣款：金额可由客户端指定（默认取 payment 记录金额），幂等键必填。 */
const captureBody = z.object({
  amount_minor: z.number().int().nonnegative().optional(),
  idempotency_key: z.string().min(1),
});

/** 支付：providers / sessions / webhooks（openapi 925/945/1014）。 */
export function storePaymentRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/store/payment-providers", async (req, reply) => {
    const channelId = await resolveChannelId(deps, req);
    const providers = await deps.services.payment.listEnabledProviders(channelId);
    reply.ok({
      items: providers.map((p) => ({ id: p.identifier, provider_id: p.identifier, label: p.label })),
      count: providers.length,
    });
  });

  app.post(
    "/api/v1/store/payment-sessions",
    { schema: { body: createSessionBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createSessionBody>;
      let collectionId = b.payment_collection_id;
      if (!collectionId && b.cart_id) {
        // 该购物车若已结账，cart-complete workflow 已建好「带 order_id + 正确金额」的支付集合
        // → 直接复用。若另建空壳集合（order_id 为 null、金额取不到），
        //   后续 capture 发出的 payment.captured 事件会缺 orderId，订单将无法自动转 paid。
        const orders = await deps.services.order.listOrders({ cartId: b.cart_id });
        for (const o of orders.items) {
          const existing = await deps.services.payment.findCollectionByOrderId(o.id);
          if (existing) {
            collectionId = existing.id;
            break;
          }
        }
        if (!collectionId) {
          const cart = await deps.services.cart.retrieveCart(b.cart_id);
          const collection = await deps.services.payment.createPaymentCollection({
            cartId: b.cart_id,
            currencyCode: cart.currency_code,
            amountMinor: cart.totals?.total_minor ?? 0n,
          });
          collectionId = collection.id;
        }
      }
      if (!collectionId) throw errors.validation("payment_collection_id or cart_id required");
      const session = await deps.services.payment.createSession({
        paymentCollectionId: collectionId,
        providerId: b.provider_id,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "payment_session.create",
          entityType: "payment_session",
          entityId: session.id,
          after: session,
        }),
      );
      reply.code(201).ok(session);
    },
  );

  // 授权（provider.authorize）：创建 payment 记录，状态 authorized
  app.post("/api/v1/store/payment-sessions/:id/authorize", async (req, reply) => {
    const { id } = req.params as { id: string };
    const payment = await deps.services.payment.authorizeSession(id);
    reply.code(201).ok(payment);
  });

  // 扣款（provider.capture）：金额取自 payment 记录，不接受客户端传价
  app.post(
    "/api/v1/store/payments/:id/capture",
    { schema: { body: captureBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof captureBody>;
      const payment = await deps.services.payment.capturePayment(
        id,
        b.amount_minor !== undefined ? BigInt(b.amount_minor) : 0n,
        b.idempotency_key,
      );
      await deps.audit.record(
        auditEntry(req, {
          action: "payment.capture",
          entityType: "payment",
          entityId: payment.id,
          after: payment,
        }),
      );
      reply.ok(payment);
    },
  );

  // 验签失败 401 且不落库；合法回调幂等去重后立即 200
  app.post("/api/v1/store/webhooks/payment/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const headers = req.headers as Record<string, string>;
      const result = await deps.services.payment.handleProviderWebhook(provider, {
        headers,
        rawBody: getRawBody(req),
      });
      // 支付状态由支付商回调驱动 → 操作者记 system，不记成访客。
      await deps.audit.record(
        auditEntry(req, {
          action: "payment.webhook",
          entityType: "payment_provider",
          entityId: provider,
          actorType: "system",
          after: result,
        }),
      );
      reply.code(200).ok({ received: true, duplicate: result.duplicate });
  });
}
