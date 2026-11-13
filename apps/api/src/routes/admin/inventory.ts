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
const listLevelsQuery = listQuery.extend({
  location_id: z.string().min(1).optional(),
  /** 库存预警：只看可用量 ≤ 该值的行（ADR-039）。 */
  low_stock_threshold: z.coerce.number().int().min(0).max(1000).optional(),
});
const createStockLocationBody = z.object({
  name: z.string().min(1),
  // priority 大者优先（与 listLocations ORDER BY priority DESC 一致）。
  priority: z.number().int().optional(),
});
const updateStockLocationBody = z.object({
  name: z.string().min(1).optional(),
  priority: z.number().int().optional(),
});
const createTransferBody = z.object({
  inventory_item_id: z.string().min(1),
  from_location_id: z.string().min(1),
  to_location_id: z.string().min(1),
  quantity: z.number().int().positive(),
  note: z.string().max(500).optional(),
});
const listTransfersQuery = listQuery.extend({
  status: z.enum(["pending", "completed", "cancelled"]).optional(),
});

/** Admin 库存 2 端点（openapi 1609/1639）+ 多仓深化：仓库 CRUD / 按仓库存行 / 调拨（ADR-013）。 */
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

  // —— 仓库（priority 大者优先）——

  app.get("/api/v1/admin/stock-locations", { preHandler: guard }, async (_req, reply) => {
    const items = await deps.services.inventory.listStockLocations();
    reply.ok({ items, count: items.length });
  });

  app.post(
    "/api/v1/admin/stock-locations",
    { preHandler: guard, schema: { body: createStockLocationBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createStockLocationBody>;
      const location = await deps.services.inventory.createStockLocation({
        name: b.name,
        priority: b.priority,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "stock_location.create",
          entityType: "stock_location",
          entityId: location.id,
          after: location,
        }),
      );
      reply.code(201).ok(location);
    },
  );

  app.patch(
    "/api/v1/admin/stock-locations/:id",
    { preHandler: guard, schema: { body: updateStockLocationBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updateStockLocationBody>;
      const before = (await deps.services.inventory.listStockLocations()).find((l) => l.id === id) ?? null;
      const location = await deps.services.inventory.updateStockLocation(id, {
        name: b.name,
        priority: b.priority,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "stock_location.update",
          entityType: "stock_location",
          entityId: id,
          before,
          after: location,
        }),
      );
      reply.ok(location);
    },
  );

  // —— 按仓库存行（仓 × SKU，后台库存/调拨页）——

  app.get(
    "/api/v1/admin/inventory-levels",
    { preHandler: guard, schema: { querystring: listLevelsQuery } },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listLevelsQuery>;
      const res = await deps.services.inventory.listInventoryLevels({
        locationId: q.location_id,
        ...(q.low_stock_threshold !== undefined
          ? { lowStockThreshold: q.low_stock_threshold }
          : {}),
        limit: q.limit,
        offset: q.offset,
      });

      /*
       * 「N 人等到货」（ADR-059 遗留项的收口）。
       *
       * 库存行只有 sku，没有变体 id；到货提醒按变体登记。所以先 sku → 变体，
       * 再一次性查这些变体的待通知人数 —— 两跳都不做 N+1。
       * 这一列是商家补货的依据：缺货且有 20 人等，和缺货但没人等，优先级完全不同。
       */
      const skus = res.items.map((i) => i.sku);
      const variantBySku = await deps.services.product.variantIdsBySkus(skus);
      const counts = await deps.services.product.countPendingStockAlerts([
        ...new Set(Object.values(variantBySku)),
      ]);

      reply.ok({
        items: res.items.map((item) => {
          const variantId = variantBySku[item.sku];
          return { ...item, stock_alert_count: variantId ? (counts[variantId] ?? 0) : 0 };
        }),
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  // —— 仓间调拨（pending 只登记不占量；complete 才搬货，单事务条件扣减）——

  app.get(
    "/api/v1/admin/inventory-transfers",
    { preHandler: guard, schema: { querystring: listTransfersQuery } },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listTransfersQuery>;
      const res = await deps.services.inventory.listInventoryTransfers({
        limit: q.limit,
        offset: q.offset,
        status: q.status,
      });
      reply.ok({
        items: res.items,
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  app.post(
    "/api/v1/admin/inventory-transfers",
    { preHandler: guard, schema: { body: createTransferBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createTransferBody>;
      const transfer = await deps.services.inventory.createInventoryTransfer({
        inventoryItemId: b.inventory_item_id,
        fromLocationId: b.from_location_id,
        toLocationId: b.to_location_id,
        quantity: b.quantity,
        note: b.note ?? null,
        createdBy: req.auth?.sub ?? null,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "inventory_transfer.create",
          entityType: "inventory_transfer",
          entityId: transfer.id,
          after: transfer,
        }),
      );
      reply.code(201).ok(transfer);
    },
  );

  app.post("/api/v1/admin/inventory-transfers/:id/complete", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const transfer = await deps.services.inventory.completeInventoryTransfer(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "inventory_transfer.complete",
        entityType: "inventory_transfer",
        entityId: id,
        before: { status: "pending" },
        after: transfer,
      }),
    );
    reply.ok(transfer);
  });

  app.post("/api/v1/admin/inventory-transfers/:id/cancel", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const transfer = await deps.services.inventory.cancelInventoryTransfer(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "inventory_transfer.cancel",
        entityType: "inventory_transfer",
        entityId: id,
        before: { status: "pending" },
        after: transfer,
      }),
    );
    reply.ok(transfer);
  });
}
