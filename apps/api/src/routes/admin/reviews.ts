import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaginationQuerySchema } from "@mall/types";
import type { ReviewDTO } from "@mall/review";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 评价管理（后台，ADR-042）。
 *
 * 位置对应淘宝「交易 → 评价管理」：评价是交易的结果，不是商品资料的一部分。
 * 商家在这里做两件事：把辱骂/广告的评价藏起来、对差评做解释。
 * 不做改分、不做代顾客写评价 —— 那会让评分失去意义。
 */

const listQuery = PaginationQuerySchema.extend({
  product_id: z.string().min(1).optional(),
  /** "false" = 只看已隐藏；不传 = 全部。 */
  visible: z.enum(["true", "false"]).optional(),
});

const patchBody = z.object({
  is_visible: z.boolean(),
});

const replyBody = z.object({
  /** 空串 = 清除解释。 */
  content: z.string().max(300),
});

function mapReview(r: ReviewDTO) {
  return {
    id: r.id,
    product_id: r.product_id,
    product_title: r.product_title,
    order_id: r.order_id,
    customer_name: r.customer_name,
    rating: r.rating,
    content: r.content,
    is_visible: r.is_visible,
    reply: r.reply,
    replied_at: r.replied_at,
    created_at: r.created_at,
  };
}

export function adminReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("orders")];

  app.get(
    "/api/v1/admin/reviews",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const q = req.query as {
        limit: number;
        offset: number;
        product_id?: string;
        visible?: "true" | "false";
      };
      const res = await deps.services.review.listReviews({
        limit: q.limit,
        offset: q.offset,
        ...(q.product_id ? { productId: q.product_id } : {}),
        ...(q.visible !== undefined ? { visible: q.visible === "true" } : {}),
      });
      reply.ok({
        items: res.items.map(mapReview),
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  /** 显示 / 隐藏（隐藏只影响店面展示，评分与内容都不改）。 */
  app.patch(
    "/api/v1/admin/reviews/:id",
    { preHandler: guard, schema: { body: patchBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof patchBody>;
      const updated = await deps.services.review.setVisible(id, b.is_visible);
      await deps.audit.record(
        auditEntry(req, {
          action: b.is_visible ? "review.show" : "review.hide",
          entityType: "review",
          entityId: id,
          after: { is_visible: updated.is_visible },
        }),
      );
      reply.ok(mapReview(updated));
    },
  );

  /** 商家解释：只写 reply 字段，评价本体一字不动。 */
  app.put(
    "/api/v1/admin/reviews/:id/reply",
    { preHandler: guard, schema: { body: replyBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof replyBody>;
      const updated = await deps.services.review.reply(id, b.content);
      await deps.audit.record(
        auditEntry(req, {
          action: "review.reply",
          entityType: "review",
          entityId: id,
          after: { reply: updated.reply },
        }),
      );
      reply.ok(mapReview(updated));
    },
  );
}
