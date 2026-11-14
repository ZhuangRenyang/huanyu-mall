import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 限时秒杀（ADR-099，对齐淘宝「营销 → 限时秒杀」）。
 *
 * 与普通促销的区别只有两条：**限时**、**限量**。
 * 限量是活动自己的库存（不是仓库库存），扣减走条件 UPDATE，卖完即止。
 *
 * 创建后是草稿，商家核对无误再「上架」—— 价格填错的秒杀一旦开卖就是资损。
 */
const listQuery = z.object({
  status: z.enum(["draft", "active", "ended"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const createBody = z.object({
  name: z.string().min(1).max(60),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  items: z
    .array(
      z.object({
        variant_id: z.string().min(1).max(40),
        /** 商品/规格快照（后台列表带过来的标题）。 */
        title: z.string().min(1).max(120),
        /**
         * 原价快照。**只用于展示与「秒杀价必须更低」的校验**，
         * 不参与实际计价：结账时用购物车里的真实单价与秒杀价比，
         * 所以即便这个值填错，也不会出现「倒贴卖」。
         */
        original_price_minor: z.number().int().positive(),
        flash_price_minor: z.number().int().positive(),
        stock: z.number().int().min(1).max(100000),
      }),
    )
    .min(1)
    .max(50),
});

const statusBody = z.object({ status: z.enum(["active", "ended"]) });

export function adminFlashSaleRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get<{ Querystring: z.infer<typeof listQuery> }>(
    "/api/v1/admin/flash-sales",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const q = req.query;
      const res = await deps.services.promotion.listFlashSales({
        status: q.status,
        limit: q.limit,
        offset: q.offset,
      });
      reply.ok({ items: res.items, count: res.count });
    },
  );

  app.post(
    "/api/v1/admin/flash-sales",
    { preHandler: guard, schema: { body: createBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createBody>;
      const sale = await deps.services.promotion.createFlashSale({
        name: b.name,
        startsAt: new Date(b.starts_at),
        endsAt: new Date(b.ends_at),
        items: b.items.map((i) => ({
          variantId: i.variant_id,
          title: i.title,
          originalPriceMinor: BigInt(i.original_price_minor),
          flashPriceMinor: BigInt(i.flash_price_minor),
          stock: i.stock,
        })),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "flash_sale.create",
          entityType: "flash_sale",
          entityId: sale.id,
          before: null,
          after: sale,
        }),
      );
      reply.code(201).ok(sale);
    },
  );

  /** 上架 / 结束：只改活动状态，不动已售数量 —— 卖出去的是既成事实。 */
  app.post(
    "/api/v1/admin/flash-sales/:id/status",
    { preHandler: guard, schema: { body: statusBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof statusBody>;
      const before = (await deps.services.promotion.listFlashSales({ limit: 100, offset: 0 })).items.find(
        (s) => s.id === id,
      );
      const after = await deps.services.promotion.setFlashSaleStatus(id, b.status);
      await deps.audit.record(
        auditEntry(req, {
          action: b.status === "active" ? "flash_sale.activate" : "flash_sale.end",
          entityType: "flash_sale",
          entityId: id,
          before: before ?? null,
          after,
        }),
      );
      reply.ok(after);
    },
  );
}
