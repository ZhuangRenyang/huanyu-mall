import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaginationQuerySchema } from "@mall/types";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { mapAdminOrder } from "../mappers.js";
import { auditEntry } from "../audit-context.js";

/**
 * 商家发起退款只需要理由：金额一律取订单实付。
 * 让客户端传金额，等于给「退多退少」开了口子。
 */
const refundBody = z.object({ reason: z.string().min(2).max(500) });
const createFulfillmentBody = z.object({
  items: z.array(z.object({ order_line_item_id: z.string(), quantity: z.number().int().min(1) })).min(1),
  reservation_ids: z.array(z.string()).optional(),
  // 发货仓（ADR-013 §3）：订单预留跨多仓时必填，单仓时可省略。
  stock_location_id: z.string().min(1).optional(),
});
const addShipmentBody = z.object({
  carrier_name: z.string(),
  tracking_number: z.string(),
  shipped_at: z.string().optional(),
});

/** Admin 订单 6 端点（openapi 1405/1435/1456/1477/1504/1529）。 */
export function adminOrderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("orders")];

  app.get(
    "/api/v1/admin/orders",
    { preHandler: guard, schema: { querystring: PaginationQuerySchema } },
    async (req, reply) => {
      const q = req.query as { limit: number; offset: number };
      const res = await deps.services.order.listOrders({ limit: q.limit, offset: q.offset });
      reply.ok({
        items: res.items,
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  app.get("/api/v1/admin/orders/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.ok(mapAdminOrder(await deps.services.order.retrieveOrder(id)));
  });

  /**
   * 商家备注（淘宝订单详情里的「商家备注」）。
   *
   * 只存后台，店面接口不下发；空串等于清空。
   */
  app.put(
    "/api/v1/admin/orders/:id/note",
    { preHandler: guard, schema: { body: z.object({ note: z.string().max(1000).nullable() }) } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { note } = req.body as { note: string | null };
      const before = await deps.services.order.retrieveOrder(id);
      const after = await deps.services.order.setMerchantNote(id, note);
      await deps.audit.record(
        auditEntry(req, {
          action: "order.note.update",
          entityType: "order",
          entityId: id,
          before: { merchant_note: before.merchant_note },
          after: { merchant_note: after.merchant_note },
        }),
      );
      reply.ok(mapAdminOrder(after));
    },
  );

  /**
   * 订单操作日志（谁在什么时候改了什么）。
   *
   * 单独开这个端点而不是复用 /admin/audit-logs：后者要 settings 权限，
   * 客服/运营拿不到；这里只要 orders 权限，且强制限定在**本订单**范围内。
   */
  app.get("/api/v1/admin/orders/:id/logs", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await deps.audit.query({
      entityType: "order",
      entityId: id,
      limit: 50,
      offset: 0,
    });
    reply.ok(res);
  });

  /**
   * 发货计划：按预留自动算出「每个仓发哪些订单行、各几件」。
   *
   * 拆分订单不再让操作员选仓、分行填数量——系统算好，人只填运单号。
   * 预留若映射不到订单行（数据异常），计入 unmatched_quantity 供排查，不静默丢。
   */
  app.get("/api/v1/admin/orders/:id/fulfillment-plan", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [order, reservations] = await Promise.all([
      deps.services.order.retrieveOrder(id),
      deps.services.inventory.listReservationsByOrder(id),
    ]);

    const lineByVariant = new Map(order.items.map((li) => [li.variant_id, li]));
    const plans = new Map<
      string,
      { stockLocationId: string; items: Map<string, number>; total: number }
    >();
    let unmatched = 0;

    for (const r of reservations) {
      const line = r.variant_id ? lineByVariant.get(r.variant_id) : undefined;
      if (!line) {
        unmatched += r.quantity;
        continue;
      }
      const plan = plans.get(r.stock_location_id) ?? {
        stockLocationId: r.stock_location_id,
        items: new Map<string, number>(),
        total: 0,
      };
      plan.items.set(line.id, (plan.items.get(line.id) ?? 0) + r.quantity);
      plan.total += r.quantity;
      plans.set(r.stock_location_id, plan);
    }

    const items = [...plans.values()]
      .sort((a, b) => a.stockLocationId.localeCompare(b.stockLocationId))
      .map((p) => ({
        stock_location_id: p.stockLocationId,
        total_quantity: p.total,
        items: [...p.items].map(([order_line_item_id, quantity]) => ({
          order_line_item_id,
          quantity,
        })),
      }));

    reply.ok({ plans: items, count: items.length, unmatched_quantity: unmatched });
  });

  // 已发货的仓与运单：跨仓订单靠它看「还差哪个仓没发」（ADR-013 §3）。
  app.get("/api/v1/admin/orders/:id/fulfillments", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const items = await deps.services.fulfillment.listByOrder(id);
    reply.ok({ items, count: items.length });
  });

  app.post("/api/v1/admin/orders/:id/cancel", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await deps.services.order.retrieveOrder(id);
    await deps.services.order.cancelOrder(id);
    const after = await deps.services.order.retrieveOrder(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "order.cancel",
        entityType: "order",
        entityId: id,
        before,
        after,
      }),
    );
    reply.ok(mapAdminOrder(after));
  });

  /**
   * 商家在订单详情发起退款（建申请单，不直接打款）。
   *
   * **所有退款都必须经过后台人工审核**：这里只把单据放进「退款管理 → 待处理」，
   * 订单同时转「退款中」并冻结发货。真正打款只发生在
   * `POST /admin/refund-requests/:id/approve`。
   *
   * 订单详情也直接退的话，等于给「退款」开了两条路，审核就成了可选步骤。
   */
  app.post(
    "/api/v1/admin/orders/:id/refunds",
    { preHandler: guard, schema: { body: refundBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof refundBody>;
      const before = await deps.services.order.retrieveOrder(id);

      const request = await deps.services.order.createRefundRequest(id, {
        // 金额取订单实付，不接受客户端传值
        amountMinor: before.total_minor,
        reason: b.reason,
        source: "merchant",
      });
      const after = await deps.services.order.retrieveOrder(id);
      await deps.audit.record(
        auditEntry(req, {
          action: "order.refund.request",
          entityType: "order",
          entityId: id,
          before,
          after: { refund: request, order: after },
        }),
      );
      reply.code(201).ok({ refund: request, order: mapAdminOrder(after) });
    },
  );

  /**
   * 订单预留明细（含仓）：后台按仓拆发货单前先让操作员选仓。
   * 只读，不写审计。
   */
  app.get("/api/v1/admin/orders/:id/reservations", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deps.services.order.retrieveOrder(id);
    const reservations = await deps.services.inventory.listReservationsByOrder(id);
    reply.ok({
      items: reservations.map((r) => ({
        id: r.id,
        stock_location_id: r.stock_location_id,
        quantity: r.quantity,
        inventory_item_id: r.inventory_item_id,
      })),
      count: reservations.length,
    });
  });

  app.post(
    "/api/v1/admin/orders/:id/fulfillments",
    { preHandler: guard, schema: { body: createFulfillmentBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof createFulfillmentBody>;

      /*
       * 退款审核中禁止发货。
       * 只把订单标成「退款中」却在别处照常发货，等于审核没生效 —— 货发了、钱也退了。
       */
      const order = await deps.services.order.retrieveOrder(id);
      if (order.status === "refund_pending") {
        throw errors.invalidState("订单正在退款审核中，不能发货。请先在「退款管理」处理退款申请");
      }
      if (order.status === "refunded") {
        throw errors.invalidState("订单已退款，不能发货");
      }

      const fulfillment = await deps.services.fulfillment.createFulfillment({
        orderId: id,
        stockLocationId: b.stock_location_id,
        items: b.items.map((i) => ({ orderLineItemId: i.order_line_item_id, quantity: i.quantity })),
        reservationIds: b.reservation_ids ?? [],
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "fulfillment.create",
          entityType: "fulfillment",
          entityId: fulfillment.id,
          after: fulfillment,
        }),
      );
      reply.code(201).ok(fulfillment);
    },
  );

  app.post(
    "/api/v1/admin/fulfillments/:id/shipments",
    { preHandler: guard, schema: { body: addShipmentBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof addShipmentBody>;

      // 发货单可能在建单时已存在（那时还没申请退款），填运单号才是真正发货 —— 同样要拦
      const fulfillment = await deps.services.fulfillment.findFulfillment(id);
      if (fulfillment) {
        const order = await deps.services.order.retrieveOrder(fulfillment.order_id);
        if (order.status === "refund_pending") {
          throw errors.invalidState("订单正在退款审核中，不能发货。请先在「退款管理」处理退款申请");
        }
        if (order.status === "refunded") {
          throw errors.invalidState("订单已退款，不能发货");
        }
      }

      const shipment = await deps.services.fulfillment.addShipment(id, {
        carrierName: b.carrier_name,
        trackingNumber: b.tracking_number,
        shippedAt: b.shipped_at ? new Date(b.shipped_at) : new Date(),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "shipment.create",
          entityType: "shipment",
          entityId: shipment.id,
          after: shipment,
        }),
      );
      reply.code(201).ok(shipment);
    },
  );
}
