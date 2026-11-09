import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { resolveChannelId } from "../../plugins/auth.js";

const shippingOptionsQuery = z.object({
  country: z.string().length(2),
  cart_id: z.string().optional(),
});

/** GET /store/shipping-options?country=&cart_id=（openapi 904）。 */
export function shippingRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    "/api/v1/store/shipping-options",
    { schema: { querystring: shippingOptionsQuery } },
    async (req, reply) => {
      const q = req.query as { country: string; cart_id?: string };
      const channelId = await resolveChannelId(deps, req);
      let subtotal = 0n;
      if (q.cart_id) {
        const cart = await deps.services.cart.retrieveCart(q.cart_id);
        subtotal = cart.totals?.subtotal_minor ?? 0n;
      }
      const options = await deps.services.fulfillment.listShippingOptions({
        channelId,
        countryCode: q.country,
        cartSubtotalMinor: subtotal,
      });
      const items = await Promise.all(
        options.map(async (o) => {
          const price = await deps.services.fulfillment.calculateShippingPrice(o.id, {
            cartSubtotalMinor: subtotal,
          });
          return {
            id: o.id,
            name: o.name,
            type: o.type,
            amount_minor: price.amountMinor,
            currency_code: price.currencyCode,
          };
        }),
      );
      reply.ok({ items, count: items.length });
    },
  );
}
