import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

const listQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

/** Admin 客户 2 端点（openapi 1554/1583）。 */
export function adminCustomerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("customers")];

  app.get(
    "/api/v1/admin/customers",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const res = await deps.services.customer.listCustomers({ q: q.q, limit: q.limit, offset: q.offset });
      reply.ok({
        items: res.items,
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  app.get("/api/v1/admin/customers/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const customer = await deps.services.customer.retrieveCustomer(id);
    const addresses = await deps.services.customer.listAddresses(id);
    reply.ok({ ...customer, addresses });
  });
}
