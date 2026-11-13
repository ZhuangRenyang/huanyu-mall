import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { refundOrderWorkflow } from "@mall/workflows";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 退款管理（对齐淘宝「交易 → 退款管理」）。
 *
 * 单据与资金分开：
 *   `refund_request`（本模块）= 谁因为什么申请退多少、商家怎么处理；
 *   `payment.refund` = 真正打给支付通道的那一笔。
 *
 * 同意退款会跑 `refundOrderWorkflow`：**先打款、再改订单状态**。
 * 顺序反了就会出现「订单显示已退款、钱没退」——比没退更糟。
 */
const listQuery = z.object({
  status: z
    .enum(["pending", "awaiting_return", "returned", "approved", "rejected", "canceled"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const approveBody = z.object({
  /** 处理说明（可不填）。 */
  note: z.string().max(500).optional(),
});

const rejectBody = z.object({
  /** 拒绝理由，必填 —— 顾客要看到为什么被拒。 */
  note: z.string().min(1).max(500),
});

export function adminRefundRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("orders")];

  /** 退款列表：默认按创建时间倒序，状态页签在后端过滤。 */
  app.get("/api/v1/admin/refund-requests", { preHandler: guard, schema: { querystring: listQuery } }, async (req, reply) => {
    const q = req.query as z.infer<typeof listQuery>;
    const res = await deps.services.order.listRefundRequests({
      status: q.status,
      limit: q.limit,
      offset: q.offset,
    });
    reply.ok({
      items: res.items,
      count: res.count,
      offset: q.offset,
      limit: q.limit,
      hasMore: q.offset + res.items.length < res.count,
      // 页签角标：待处理优先，商家一眼知道还有几单要审
      counts: {
        pending: res.counts.pending ?? 0,
        awaiting_return: res.counts.awaiting_return ?? 0,
        returned: res.counts.returned ?? 0,
        approved: res.counts.approved ?? 0,
        rejected: res.counts.rejected ?? 0,
        canceled: res.counts.canceled ?? 0,
        all: Object.values(res.counts).reduce((n, v) => n + v, 0),
      },
    });
  });

  /**
   * 同意退款：执行打款 + 订单转已退款 + 回写申请单。
   *
   * 这是全仓**唯一**的退款触发点，且必须人工点击（ADR-023 §7「不做自动退款」）。
   * 不要把它接到定时任务、订阅者或超时策略上。
   *
   * 幂等：workflow 的幂等键绑申请单 id，重复点击不会退两次；
   * 申请单状态非 pending 时服务层直接拒绝。
   */
  app.post(
    "/api/v1/admin/refund-requests/:id/approve",
    { preHandler: guard, schema: { body: approveBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof approveBody>;
      const request = await deps.services.order.findRefundRequest(id);
      if (!request) {
        return reply.code(404).send({
          code: 30001,
          data: null,
          message: `退款申请不存在：${id}`,
          requestId: req.id,
        });
      }

      /*
       * 状态必须在**跑工作流之前**校验。
       * 反过来写（先退款再让服务层抛 409）意味着：对一张已拒绝的单子点同意，
       * 钱会先退出去，然后才报「已处理」—— 重复退款就是这么来的。
       */
      if (request.status !== "pending") {
        return reply.code(409).send({
          code: 30002,
          data: null,
          message: `该退款申请已处理（当前状态：${request.status}）`,
          requestId: req.id,
        });
      }

      /*
       * 退货退款：这一步**不打款**，只是同意退货并等买家寄回（ADR-051）。
       * 钱在 `/receive-return`（商家确认收到货）那一步才走 —— 货没回来先退钱，
       * 商家就是净亏一单，而这种亏是被自己的按钮造成的。
       */
      if (request.resolution === "return_refund") {
        /*
         * 地址在**这一刻**快照进单据（ADR-061）。
         * 读主题设置放在路由层：order 模块不该认识 theme，
         * 跨模块的取值留在组合根附近，模块只管存与取。
         */
        const theme = await deps.services.theme.getSettings();
        const agreed = await deps.services.order.agreeReturnRequest(id, {
          reviewNote: body.note ?? null,
          returnAddress: theme.return_address,
        });
        await deps.audit.record(
          auditEntry(req, {
            action: "refund.agree_return",
            entityType: "refund_request",
            entityId: id,
            before: request,
            after: agreed,
          }),
        );
        reply.ok(agreed);
        return;
      }

      const { result } = await deps.workflow.run(
        refundOrderWorkflow,
        {
          orderId: request.order_id,
          refundRequestId: request.id,
          amountMinor: Number(request.amount_minor),
          reason: request.reason,
        },
        { idempotencyKey: `refund-approve:${request.id}` },
      );

      const refundId = (result as { refundId: string }).refundId;
      const after = await deps.services.order.approveRefundRequest(id, refundId, body.note ?? null);
      await deps.audit.record(
        auditEntry(req, {
          action: "refund.approve",
          entityType: "refund_request",
          entityId: id,
          before: request,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  /**
   * 确认收到退货并退款（退货退款的打款关卡，ADR-051）。
   *
   * 与仅退款同一顺序：先跑 workflow 打款，再回写单据 ——
   * 反过来会出现「单据已退款、钱没退」。
   *
   * 状态必须是 `returned`（买家已填退货单号）。待处理 / 待买家寄回都不许调：
   * 前者应该走同意，后者货还在路上。
   */
  app.post(
    "/api/v1/admin/refund-requests/:id/receive-return",
    { preHandler: guard, schema: { body: approveBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof approveBody>;
      const request = await deps.services.order.findRefundRequest(id);
      if (!request) {
        return reply.code(404).send({
          code: 30001,
          data: null,
          message: `退款申请不存在：${id}`,
          requestId: req.id,
        });
      }
      // 与同意端点同一条纪律：状态校验放在打款之前
      if (request.status !== "returned") {
        return reply.code(409).send({
          code: 30002,
          data: null,
          message: `当前状态（${request.status}）不能确认收货，需要买家先寄回并填写退货单号`,
          requestId: req.id,
        });
      }

      const { result } = await deps.workflow.run(
        refundOrderWorkflow,
        {
          orderId: request.order_id,
          refundRequestId: request.id,
          amountMinor: Number(request.amount_minor),
          reason: request.reason,
        },
        // 幂等键与同意端点区分：同一张单据不会因为走两条路各退一次
        { idempotencyKey: `refund-receive:${request.id}` },
      );

      const refundId = (result as { refundId: string }).refundId;
      const after = await deps.services.order.confirmReturnReceived(
        id,
        refundId,
        body.note ?? null,
      );
      await deps.audit.record(
        auditEntry(req, {
          action: "refund.receive_return",
          entityType: "refund_request",
          entityId: id,
          before: request,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  /** 拒绝退款：只改单据状态，不动资金。理由必填。 */
  app.post(
    "/api/v1/admin/refund-requests/:id/reject",
    { preHandler: guard, schema: { body: rejectBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof rejectBody>;
      const before = await deps.services.order.findRefundRequest(id);
      const after = await deps.services.order.rejectRefundRequest(id, body.note);
      await deps.audit.record(
        auditEntry(req, {
          action: "refund.reject",
          entityType: "refund_request",
          entityId: id,
          before,
          after,
        }),
      );
      reply.ok(after);
    },
  );
}
