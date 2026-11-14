import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 会员等级（ADR-102，对齐 CRMEB「会员 → 会员等级」）。
 *
 * 等级只做两件事：给名字、给折扣。归属由**累计消费**自动匹配（读时计算，不落库），
 * 所以改完规则，顾客下次进店就按新规则走 —— 不需要跑任何刷数据的任务。
 *
 * 折扣力度上限 30%：再高不是会员权益，是清仓。
 */
const createBody = z.object({
  name: z.string().min(1).max(40),
  /** 门槛（minor）：达到该累计消费即为这一档。 */
  threshold_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** 折扣力度（万分比）：500 = 便宜 5%。 */
  discount_bps: z.number().int().min(1).max(3000),
});

const updateBody = createBody.partial();

export function adminMemberLevelRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("customers")];

  app.get("/api/v1/admin/member-levels", { preHandler: guard }, async (_req, reply) => {
    reply.ok({ items: await deps.services.customer.listMemberLevels() });
  });

  app.post(
    "/api/v1/admin/member-levels",
    { preHandler: guard, schema: { body: createBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createBody>;
      const level = await deps.services.customer.createMemberLevel({
        name: b.name,
        thresholdMinor: BigInt(b.threshold_minor),
        discountBps: b.discount_bps,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "member_level.create",
          entityType: "member_level",
          entityId: level.id,
          before: null,
          after: level,
        }),
      );
      reply.code(201).ok(level);
    },
  );

  app.patch(
    "/api/v1/admin/member-levels/:id",
    { preHandler: guard, schema: { body: updateBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updateBody>;
      const after = await deps.services.customer.updateMemberLevel(id, {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.threshold_minor !== undefined ? { thresholdMinor: BigInt(b.threshold_minor) } : {}),
        ...(b.discount_bps !== undefined ? { discountBps: b.discount_bps } : {}),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "member_level.update",
          entityType: "member_level",
          entityId: id,
          before: null,
          after,
        }),
      );
      reply.ok(after);
    },
  );
}
