import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import { PaginationQuerySchema } from "@mall/types";
import type { AppDeps } from "../../deps.js";
import { mapOrder } from "../mappers.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

const refundRequestBody = z.object({
  /** 顾客只说明原因；金额一律由服务端按订单实付取（铁律 13，客户端不传金额）。 */
  reason: z.string().min(2).max(500),
});

const listQuery = PaginationQuerySchema.extend({
  status: z
    .enum([
      "pending",
      "awaiting_payment",
      "paid",
      "partially_fulfilled",
      "fulfilled",
      "delivered",
      "completed",
      "canceled",
      "refund_pending",
      "refunded",
    ])
    .optional(),
});

/**
 * 订单归属判定（店面统一的唯一口径）。
 *
 * - 有 customer_id 的订单：**必须登录且是本人**。之前写的是
 *   `if (order.customer_id && req.auth && ...)` —— 未登录时整段被跳过，
 *   只要知道订单号就能看到别人的地址与手机号。
 * - 游客单（customer_id 为空）：仍允许按单号查。订单号是 ULID 不可枚举，
 *   且顾客下单后确实需要一个无需注册的查询入口。
 */
function assertOrderAccess(
  order: { customer_id: string | null },
  auth: { customerId: string | null } | undefined,
): void {
  if (!order.customer_id) return;
  if (!auth?.customerId || auth.customerId !== order.customer_id) {
    throw errors.forbidden("这不是你的订单");
  }
}

/**
 * 店面订单接口：我的订单列表 + 详情 / 申请退款 / 退款进度。
 *
 * 列表是「我的订单」的底座：只看 token 里的 customerId，不接受 query 传 customer_id
 * —— 否则改个参数就能翻别人的订单。
 */
export function storeOrderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  /**
   * 我的订单（淘宝「已买到的宝贝」）。
   *
   * 必须登录：未登录返回 401，而不是空列表 —— 空列表会让顾客以为订单丢了。
   */
  app.get<{ Querystring: z.infer<typeof listQuery> }>(
    "/api/v1/store/orders",
    { preHandler: auth.customerAuth, schema: { querystring: listQuery } },
    async (req, reply) => {
      if (!req.auth || req.auth.scope !== "customer" || !req.auth.customerId) {
        throw errors.unauthenticated("请先登录后查看订单");
      }
      const q = req.query;
      const res = await deps.services.order.listOrderSummaries({
        customerId: req.auth.customerId,
        status: q.status,
        limit: q.limit,
        offset: q.offset,
      });
      reply.ok({
        items: res.items.map(mapOrder),
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  /** GET /store/orders/{id} — 本人订单或游客按单号查（openapi 992）。 */
  app.get("/api/v1/store/orders/:id", { preHandler: auth.customerAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await deps.services.order.retrieveOrder(id);
    assertOrderAccess(order, req.auth);
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
    { preHandler: auth.customerAuth, schema: { body: refundRequestBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof refundRequestBody>;
      const order = await deps.services.order.retrieveOrder(id);
      assertOrderAccess(order, req.auth);

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
  app.get(
    "/api/v1/store/orders/:id/refund-requests",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await deps.services.order.retrieveOrder(id);
    assertOrderAccess(order, req.auth);
    // 直接在查询层按订单收敛：拉全量再过滤会漏（别人的申请排在前面时）
    const res = await deps.services.order.listRefundRequests({
      orderId: id,
      limit: 20,
      offset: 0,
    });
    reply.ok({ items: res.items });
    },
  );
}
