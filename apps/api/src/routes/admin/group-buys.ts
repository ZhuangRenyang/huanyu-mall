import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 拼团（ADR-100，对齐 CRMEB「营销 → 拼团」）。
 *
 * 本项目的拼团是**参团免费、成团领券**：参团不收款、不建订单、不占库存；
 * 成团后每个成员领一张「拼团专享券」，拿券正常下单。
 *
 * 为什么不做「先付款再等人凑齐」：那需要「未成团自动退款」，
 * 而 ADR-023 定的是退款只走人工审核。参团免费的模式下，未成团什么都没有发生，
 * 也就不需要任何无人值守的资金动作。
 */
const listQuery = z.object({
  status: z.enum(["draft", "active", "ended"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const createBody = z.object({
  name: z.string().min(1).max(60),
  /** 活动只针对一个规格：一个活动一个价，规则才解释得清。 */
  variant_id: z.string().min(1).max(40),
  /** 商品/规格快照（后台列表带过来的标题）。 */
  title: z.string().min(1).max(120),
  /**
   * 原价快照：只用于「拼团价必须更低」的校验与券面额计算。
   * 实际成交价仍由券 + 订单金额走既有链路，不会被这个值带偏。
   */
  original_price_minor: z.number().int().positive(),
  group_price_minor: z.number().int().positive(),
  team_size: z.number().int().min(2).max(10),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
});

const statusBody = z.object({ status: z.enum(["active", "ended"]) });

export function adminGroupBuyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get<{ Querystring: z.infer<typeof listQuery> }>(
    "/api/v1/admin/group-buys",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const q = req.query;
      const res = await deps.services.promotion.listGroupBuys({
        status: q.status,
        limit: q.limit,
        offset: q.offset,
      });
      reply.ok({ items: res.items, count: res.count });
    },
  );

  app.post(
    "/api/v1/admin/group-buys",
    { preHandler: guard, schema: { body: createBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createBody>;
      // 商品的 product_id 由服务端查出来：拼团券按商品设范围，不能信客户端传的
      const variants = await deps.services.product.listVariantsByIds([b.variant_id]);
      const variant = variants[0];
      if (!variant) throw errors.validation("拼团商品规格不存在");

      const activity = await deps.services.promotion.createGroupBuy({
        name: b.name,
        variantId: variant.id,
        productId: variant.product_id,
        title: b.title,
        originalPriceMinor: BigInt(b.original_price_minor),
        groupPriceMinor: BigInt(b.group_price_minor),
        teamSize: b.team_size,
        startsAt: new Date(b.starts_at),
        endsAt: new Date(b.ends_at),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "group_buy.create",
          entityType: "group_buy",
          entityId: activity.id,
          before: null,
          after: activity,
        }),
      );
      reply.code(201).ok(activity);
    },
  );

  app.post(
    "/api/v1/admin/group-buys/:id/status",
    { preHandler: guard, schema: { body: statusBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof statusBody>;
      const after = await deps.services.promotion.setGroupBuyStatus(id, b.status);
      await deps.audit.record(
        auditEntry(req, {
          action: b.status === "active" ? "group_buy.activate" : "group_buy.end",
          entityType: "group_buy",
          entityId: id,
          before: null,
          after,
        }),
      );
      reply.ok(after);
    },
  );
}
