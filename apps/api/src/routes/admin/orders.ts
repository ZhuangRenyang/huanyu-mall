import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaginationQuerySchema } from "@mall/types";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { mapAdminOrder } from "../mappers.js";
import { auditEntry } from "../audit-context.js";

const refundBody = z.object({ amount_minor: z.number().int().positive(), reason: z.string().optional() });
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

  app.post(
    "/api/v1/admin/orders/:id/refunds",
    { preHandler: guard, schema: { body: refundBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof refundBody>;
      const before = await deps.services.order.retrieveOrder(id);
      const refundRequest = await deps.services.order.createRefundRequest(id, {
        amountMinor: BigInt(b.amount_minor),
        reason: b.reason ?? "admin refund",
      });
      await deps.services.order.markRefundSettled(id, "auto");
      const after = await deps.services.order.retrieveOrder(id);
      await deps.audit.record(
        auditEntry(req, {
          action: "order.refund",
          entityType: "order",
          entityId: id,
          before,
          after: { refund: refundRequest, order: after },
        }),
      );
      reply.ok({ refund: refundRequest, order: mapAdminOrder(after) });
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
