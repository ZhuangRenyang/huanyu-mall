import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { mapOrder } from "../mappers.js";

const refundRequestBody = z.object({
  /** 顾客只说明原因；金额一律由服务端按订单实付取（铁律 13，客户端不传金额）。 */
  reason: z.string().min(2).max(500),
});

/** GET /store/orders/{id} — customer 归属或游客 order id 访问（openapi 992）。 */
export function storeOrderRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/store/orders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await deps.services.order.retrieveOrder(id);
    if (order.customer_id && req.auth && req.auth.sub !== order.customer_id) {
      throw errors.forbidden("not your order");
    }
    reply.ok(mapOrder(order));
  });

  /**
   * 顾客申请退款（淘宝「申请售后」）。
   *
   * 只落申请单，钱不在这里退 —— 商家在后台「退款管理」里同意后才打款。
   * 金额取订单实付，顾客不能传金额，也不能只退一部分（一期只支持全额）。
   */
  app.post(
    "/api/v1/store/orders/:id/refund-requests",
    { schema: { body: refundRequestBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof refundRequestBody>;
      const order = await deps.services.order.retrieveOrder(id);
      if (order.customer_id && req.auth && req.auth.sub !== order.customer_id) {
        throw errors.forbidden("not your order");
      }

      const request = await deps.services.order.createRefundRequest(id, {
        amountMinor: order.total_minor,
        reason: body.reason,
        source: "customer",
        customerId: order.customer_id,
      });
      reply.code(201).ok(request);
    },
  );

  /** 该订单的退款申请进度（顾客在订单页看「处理中 / 已退款 / 已拒绝」）。 */
  app.get("/api/v1/store/orders/:id/refund-requests", async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await deps.services.order.retrieveOrder(id);
    if (order.customer_id && req.auth && req.auth.sub !== order.customer_id) {
      throw errors.forbidden("not your order");
    }
    const res = await deps.services.order.listRefundRequests({ limit: 20, offset: 0 });
    // 服务层没有按订单过滤的查询：这里按 order_id 收敛，避免泄露别人的申请
    reply.ok({ items: res.items.filter((r) => r.order_id === id) });
  });
}
