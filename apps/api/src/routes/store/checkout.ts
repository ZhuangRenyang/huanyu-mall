import { errors } from "@mall/core";
import type { FastifyInstance } from "fastify";
import { cartCompleteWorkflow } from "@mall/workflows";
import type { AppDeps } from "../../deps.js";
import { mapOrder } from "../mappers.js";
import { auditEntry } from "../audit-context.js";

/** POST /store/carts/{id}/complete — 走 cart-complete workflow + 幂等键（openapi 969）。 */
export function checkoutRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/api/v1/store/carts/:id/complete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const idempotencyKey = (req.headers["idempotency-key"] as string | undefined) ?? `auto_${id}`;

    const cart = await deps.services.cart.retrieveCart(id);
    // 仓库动态取（一期单仓：priority 最高的即默认仓），不硬编码
    const locations = await deps.services.inventory.listStockLocations();
    const locationId = locations[0]?.id;
    if (!locationId) throw errors.notFound("未配置库存仓库");

    const input = {
      cartId: id,
      email: cart.email ?? "guest@example.com",
      currencyCode: cart.currency_code,
      channelId: cart.channel_id,
      regionId: cart.region_id,
      shippingAddress: {},
      shippingMinor: cart.shipping_method?.amount_minor ?? 0n,
      items: cart.items.map((li) => ({
        variantId: li.variant_id,
        productId: li.product_id,
        title: li.title,
        sku: li.variant_id,
        quantity: li.quantity,
        unitPriceMinor: li.unit_price_minor,
        locationId,
        snapshot: {},
      })),
    };

    const { result } = await deps.workflow.run(cartCompleteWorkflow, input, { idempotencyKey });
    const order = await deps.services.order.retrieveOrder((result as { orderId: string }).orderId);
    const view = mapOrder(order);
    await deps.audit.record(
      auditEntry(req, {
        action: "order.create",
        entityType: "order",
        entityId: order.id,
        after: view,
      }),
    );
    reply.code(201).ok(view);
  });
}
