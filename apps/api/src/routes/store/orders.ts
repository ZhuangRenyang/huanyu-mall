import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import { PaginationQuerySchema } from "@mall/types";
import type { AppDeps } from "../../deps.js";
import { mapOrder } from "../mappers.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { cancelOrderAndReleaseStock } from "../../lib/cancel-order.js";

const refundRequestBody = z.object({
  /** 顾客只说明原因；金额一律由服务端按订单实付取（铁律 13，客户端不传金额）。 */
  reason: z.string().min(2).max(500),
  /**
   * 售后类型（ADR-051）：仅退款 / 退货退款。
   * 缺省 refund_only —— 老客户端不带这个字段时保持原行为，不会突然进「等寄回」。
   */
  resolution: z.enum(["refund_only", "return_refund", "exchange"]).default("refund_only"),
  /** 换货目标规格（ADR-090）：resolution=exchange 时必填。 */
  exchange_variant_id: z.string().max(40).optional(),
  /** 换货数量（ADR-090）：默认 1。 */
  exchange_quantity: z.number().int().min(1).max(999).optional(),
});

/** 退货物流：公司 + 单号都必填（没有单号，「已寄出」无从对账）。 */
const returnShipmentBody = z.object({
  carrier: z.string().min(1).max(60),
  tracking_number: z.string().min(4).max(60),
});

/** 页签可含多个状态（待收货 = fulfilled + delivered），用逗号分隔。 */
const listQuery = PaginationQuerySchema.extend({
  status: z
    .string()
    .max(160)
    .optional(),
});

const ORDER_STATUSES = [
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
] as const;
type StoreOrderStatus = (typeof ORDER_STATUSES)[number];

/** 逗号分隔 → 状态数组；非法值忽略（不 400，老前端不会因为多传一个值就白屏）。 */
function parseStatuses(raw: string | undefined): StoreOrderStatus[] | undefined {
  if (!raw) return undefined;
  const picked = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is StoreOrderStatus => (ORDER_STATUSES as readonly string[]).includes(s));
  return picked.length > 0 ? picked : undefined;
}

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
      const statuses = parseStatuses(q.status);
      const res = await deps.services.order.listOrderSummaries({
        customerId: req.auth.customerId,
        ...(statuses ? { statuses } : {}),
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

  /**
   * 取消未付款订单（淘宝「取消订单」，ADR-075）。
   *
   * 只有买家自己能取消，且只限**未付款**：付过款的单必须先走退款审核 ——
   * 取消订单只释放库存、不涉及资金，这条线不能用来绕开退款流程。
   */
  app.post(
    "/api/v1/store/orders/:id/cancel",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
      if (!req.auth || req.auth.scope !== "customer" || !req.auth.customerId) {
        throw errors.unauthenticated("请先登录");
      }
      const { id } = req.params as { id: string };
      const order = await deps.services.order.retrieveOrder(id);
      assertOrderAccess(order, req.auth);
      if (order.status !== "pending" && order.status !== "awaiting_payment") {
        throw errors.validation(
          order.status === "canceled"
            ? "订单已经取消过了"
            : "只有未付款的订单可以直接取消，已付款请申请售后",
        );
      }

      await cancelOrderAndReleaseStock(deps, id);
      const after = await deps.services.order.retrieveOrder(id);
      reply.ok(mapOrder(after));
    },
  );

  /**
   * 确认收货（淘宝「确认收货」）。
   *
   * 状态机允许 fulfilled → completed；delivered 是承运商签收，不是必经步骤。
   * 只有买家自己能确认 —— 商家代确认等于替顾客承认「货收到了」。
   */
  app.post(
    "/api/v1/store/orders/:id/confirm-receipt",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
      if (!req.auth || req.auth.scope !== "customer" || !req.auth.customerId) {
        throw errors.unauthenticated("请先登录");
      }
      const { id } = req.params as { id: string };
      const order = await deps.services.order.retrieveOrder(id);
      assertOrderAccess(order, req.auth);
      if (order.status !== "fulfilled" && order.status !== "delivered") {
        throw errors.validation(`当前状态（${order.status}）不能确认收货`);
      }
      await deps.services.order.transition(id, "completed", {
        actor: "customer",
        reason: "买家确认收货",
      });
      /*
       * 订单完成发放积分（ADR-093）。
       *
       * 只在积分功能开启时发；按订单实付折算，同一订单幂等（服务层去重）。
       * 发放失败不影响确认收货本身 —— 积分是赠予，不能因为它把「确认收货」也报错，
       * 让顾客以为货没确认。失败记日志即可。
       */
      if (order.customer_id) {
        try {
          const flags = await deps.services.promotion.getFeatureFlags();
          if (flags.points) {
            await deps.services.promotion.earnPointsForOrder(
              order.customer_id,
              id,
              order.total_minor,
            );
          }
        } catch (err) {
          req.log.warn({ err, orderId: id }, "订单完成发放积分失败");
        }
      }
      // 重新取一次：transition 返回的 DTO 不带行项，前端要整单渲染
      reply.ok(mapOrder(await deps.services.order.retrieveOrder(id)));
    },
  );

  /** GET /store/orders/{id} — 本人订单或游客按单号查（openapi 992）。 */
  app.get("/api/v1/store/orders/:id", { preHandler: auth.customerAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await deps.services.order.retrieveOrder(id);
    assertOrderAccess(order, req.auth);

    /*
     * 带上发货单：商家在后台填了快递单号，顾客必须能在「我的订单」看到 ——
     * 「我的包裹到哪了」是下单后最高频的查询。改造前这个接口不返回物流，
     * 店面前端即便有渲染分支也永远是空的（ADR-033）。
     */
    const [fulfillments, payment, reviews] = await Promise.all([
      deps.services.fulfillment.listByOrder(id),
      // 支付渠道：顾客要看到「我用什么付的」。没有支付单（未付款/货到付款）就返回 null
      deps.services.payment.findPaymentByOrderId(id).catch(() => null),
      // 已评价的商品：「我的订单」据此把「评价」按钮换成「已评价」（ADR-042）
      deps.services.review.listByOrder(id).catch(() => []),
    ]);

    let paymentProvider: { id: string; label: string } | null = null;
    if (payment) {
      // provider_id 是内部标识（如 paypal），展示要用渠道配置里的 label
      const providers = await deps.services.payment
        .listEnabledProviders(order.channel_id)
        .catch(() => []);
      const found = providers.find((p) => p.identifier === payment.provider_id);
      paymentProvider = { id: payment.provider_id, label: found?.label ?? payment.provider_id };
    }

    reply.ok({
      ...mapOrder(order),
      fulfillments: fulfillments.map((f) => ({
        id: f.id,
        status: f.status,
        tracking_links: f.tracking_links ?? [],
      })),
      payment_provider: paymentProvider,
      reviewed_product_ids: reviews.map((r) => r.product_id),
    });
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

      /*
       * 换货（ADR-090）：目标规格必须是**同一商品**的另一个规格，且要能查到。
       * 跨商品换货、或给一个不存在的规格，商家同意后都不知道发什么。
       * 标签在此快照进单据：规格后来下架/删除，这张单仍可读。
       */
      let exchangeVariantId: string | undefined;
      let exchangeQuantity: number | undefined;
      let exchangeLabel: string | null = null;
      if (body.resolution === "exchange") {
        if (!body.exchange_variant_id) {
          throw errors.validation("换货必须指定目标规格");
        }
        const variants = await deps.services.product.listVariantsByIds([body.exchange_variant_id]);
        const variant = variants[0];
        if (!variant) throw errors.validation("换货目标规格不存在");
        const orderProductIds = new Set((order.items ?? []).map((li) => li.product_id));
        if (!orderProductIds.has(variant.product_id)) {
          throw errors.validation("换货只能换成同一商品的其它规格");
        }
        exchangeVariantId = variant.id;
        exchangeQuantity = body.exchange_quantity ?? 1;
        exchangeLabel = variant.title || variant.sku;
      }

      const request = await deps.services.order.createRefundRequest(id, {
        amountMinor: order.total_minor,
        reason: body.reason,
        source: "customer",
        customerId: order.customer_id,
        resolution: body.resolution,
        exchangeVariantId,
        exchangeQuantity,
        exchangeLabel,
      });
      reply.code(201).ok(request);
    },
  );

  /**
   * 买家提交退货物流（退货退款第二步，ADR-051）。
   *
   * 商家同意退货后，顾客把货寄回，在这里填物流公司与单号。
   * 之后单据进「待商家收货」，商家确认收到才打款 —— 钱不会在货没回来时先走。
   */
  app.post(
    "/api/v1/store/refund-requests/:id/return-shipment",
    { preHandler: auth.customerAuth, schema: { body: returnShipmentBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof returnShipmentBody>;
      const request = await deps.services.order.findRefundRequest(id);
      if (!request) throw errors.notFound(`退款申请不存在：${id}`);
      // 归属按**订单**判定：单据上的 customer_id 可能为空（游客单），订单口径才统一
      const order = await deps.services.order.retrieveOrder(request.order_id);
      assertOrderAccess(order, req.auth);

      const after = await deps.services.order.shipReturn(id, {
        carrier: body.carrier,
        trackingNumber: body.tracking_number,
      });
      reply.ok(after);
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
