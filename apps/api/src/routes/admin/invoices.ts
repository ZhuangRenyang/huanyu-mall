import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 发票管理（ADR-098，对齐淘宝「交易 → 发票管理」）。
 *
 * 不接税务服务商，做**手工登记**：顾客提交抬头 → 商家线下开票 → 后台登记发票号。
 *
 * 之所以先做手工版：开票接口要税号/税盘/服务商资质，外部依赖不可控；
 * 而「顾客能提申请、商家能登记、双方能查状态」这套业务闭环，手工版已经够用，
 * 将来接入服务商只需替换「登记发票号」那一步，状态机与单据不变。
 */
const listQuery = z.object({
  status: z.enum(["pending", "issued", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const issueBody = z.object({
  /** 发票号码：线下开出的那张票上的号，必填。 */
  invoice_no: z.string().min(4).max(60),
  /** 开票备注（可不填）。 */
  note: z.string().max(300).optional(),
});

const rejectBody = z.object({
  /** 拒绝原因，必填 —— 顾客要看到为什么开不了票。 */
  note: z.string().min(1).max(300),
});

export function adminInvoiceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("orders")];

  /** 发票单列表 + 各状态角标。 */
  app.get<{ Querystring: z.infer<typeof listQuery> }>(
    "/api/v1/admin/invoices",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const q = req.query;
      const [res, counts] = await Promise.all([
        deps.services.order.listInvoices({
          status: q.status,
          limit: q.limit,
          offset: q.offset,
        }),
        deps.services.order.countInvoicesByStatus(),
      ]);
      reply.ok({
        items: res.items,
        count: res.count,
        counts: {
          pending: counts.pending ?? 0,
          issued: counts.issued ?? 0,
          rejected: counts.rejected ?? 0,
          all: Object.values(counts).reduce((a, b) => a + b, 0),
        },
      });
    },
  );

  /**
   * 登记开票（pending → issued）。
   *
   * 只登记发票号，不动钱、不动订单状态 —— 开票是财务动作，不是交易动作。
   */
  app.post(
    "/api/v1/admin/invoices/:id/issue",
    { preHandler: guard, schema: { body: issueBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof issueBody>;
      const invoice = await deps.services.order.issueInvoice(id, {
        invoiceNo: body.invoice_no,
        note: body.note ?? null,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "invoice.issue",
          entityType: "order_invoice",
          entityId: id,
          before: null,
          after: invoice,
        }),
      );
      reply.ok(invoice);
    },
  );

  /** 拒绝开票（pending → rejected），原因必填。 */
  app.post(
    "/api/v1/admin/invoices/:id/reject",
    { preHandler: guard, schema: { body: rejectBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof rejectBody>;
      const invoice = await deps.services.order.rejectInvoice(id, body.note);
      await deps.audit.record(
        auditEntry(req, {
          action: "invoice.reject",
          entityType: "order_invoice",
          entityId: id,
          before: null,
          after: invoice,
        }),
      );
      reply.ok(invoice);
    },
  );
}
