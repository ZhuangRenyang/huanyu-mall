import type { FastifyInstance } from "fastify";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { mapOrder } from "../mappers.js";

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
}
