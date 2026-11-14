import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 分销（ADR-101，对齐 CRMEB「营销 → 分销」）。
 *
 * 两件事：把客户设成推广员（发推广码 + 佣金比例）；看佣金流水并**人工结算**。
 *
 * 红线：系统不发一分钱。`settle` 只是把流水标成「已结算」——商家线下打款之后
 * 才点它。不做「点结算自动转账」。
 */
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const registerBody = z.object({
  customer_id: z.string().min(1).max(40),
  /** 不传则服务端生成（8 位大写字母数字）。 */
  code: z.string().min(4).max(16).optional(),
  /** 佣金比例（万分比）：500 = 5%，上限 3000（30%）。 */
  commission_bps: z.number().int().min(1).max(3000),
});

const statusBody = z.object({ status: z.enum(["active", "disabled"]) });

const commissionQuery = z.object({
  affiliate_id: z.string().max(40).optional(),
  status: z.enum(["pending", "settled", "canceled"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export function adminAffiliateRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get<{ Querystring: z.infer<typeof listQuery> }>(
    "/api/v1/admin/affiliates",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const res = await deps.services.promotion.listAffiliates({
        limit: req.query.limit,
        offset: req.query.offset,
      });
      reply.ok({ items: res.items, count: res.count });
    },
  );

  app.post(
    "/api/v1/admin/affiliates",
    { preHandler: guard, schema: { body: registerBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof registerBody>;
      const affiliate = await deps.services.promotion.registerAffiliate({
        customerId: b.customer_id,
        code: b.code,
        commissionBps: b.commission_bps,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "affiliate.register",
          entityType: "affiliate",
          entityId: affiliate.id,
          before: null,
          after: affiliate,
        }),
      );
      reply.code(201).ok(affiliate);
    },
  );

  /** 停用 / 恢复：停用后推广码立即失效，已产生的佣金不受影响。 */
  app.post(
    "/api/v1/admin/affiliates/:id/status",
    { preHandler: guard, schema: { body: statusBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof statusBody>;
      const after = await deps.services.promotion.setAffiliateStatus(id, b.status);
      await deps.audit.record(
        auditEntry(req, {
          action: b.status === "active" ? "affiliate.enable" : "affiliate.disable",
          entityType: "affiliate",
          entityId: id,
          before: null,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  app.get<{ Querystring: z.infer<typeof commissionQuery> }>(
    "/api/v1/admin/commissions",
    { preHandler: guard, schema: { querystring: commissionQuery } },
    async (req, reply) => {
      const q = req.query;
      const res = await deps.services.promotion.listCommissions({
        affiliateId: q.affiliate_id,
        status: q.status,
        limit: q.limit,
        offset: q.offset,
      });
      reply.ok({ items: res.items, count: res.count });
    },
  );

  /**
   * 标记已结算。
   *
   * 系统不转账：商家线下（微信/支付宝/银行卡）打款给推广员后，回这里点一下。
   */
  app.post("/api/v1/admin/commissions/:id/settle", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const after = await deps.services.promotion.settleCommission(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "commission.settle",
        entityType: "affiliate_commission",
        entityId: id,
        before: null,
        after,
      }),
    );
    reply.ok(after);
  });
}
