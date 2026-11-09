import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
const adjustBody = z.object({
  delta: z.number().int(),
  reason: z.string().default("admin adjust"),
});

/** Admin 库存 2 端点（openapi 1609/1639）。 */
export function adminInventoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("inventory")];

  app.get(
    "/api/v1/admin/inventory-items",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const res = await deps.services.inventory.listInventoryItems({ limit: q.limit, offset: q.offset });
      reply.ok({
        items: res.items,
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  app.put(
    "/api/v1/admin/inventory-levels/:id",
    { preHandler: guard, schema: { body: adjustBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof adjustBody>;
      const level = await deps.services.inventory.adjustLevelByLevelId(id, { delta: b.delta, reason: b.reason });
      await deps.audit.record(
        auditEntry(req, {
          action: "inventory.adjust",
          entityType: "inventory_level",
          entityId: id,
          after: { ...level, delta: b.delta, reason: b.reason },
        }),
      );
      reply.ok(level);
    },
  );
}
