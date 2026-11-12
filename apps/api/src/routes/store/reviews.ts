import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import { PaginationQuerySchema } from "@mall/types";
import type { ReviewDTO } from "@mall/review";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers, resolveChannelId } from "../../plugins/auth.js";

/**
 * 商品评价（店面，ADR-042）。
 *
 * - 读：匿名可读（商品页没登录的顾客占多数，评价是转化信息）。
 * - 写：必须登录，且订单归属、已收货、商品在订单里都由服务层校验。
 *   路由只做字段形状，不重复业务判断。
 */

const createReviewBody = z.object({
  order_id: z.string().min(1),
  product_id: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  content: z.string().max(500).optional(),
});

const listReviewsQuery = PaginationQuerySchema;

/**
 * 提交评价必须登录。
 *
 * customerAuth 是「可选鉴权」（店面匿名可读），没带 token 时直接放行 ——
 * 所以这里必须自己判，否则匿名请求会一路走到写库。
 */
function requireCustomerId(req: FastifyRequest): string {
  if (!req.auth || req.auth.scope !== "customer" || !req.auth.customerId) {
    throw errors.unauthenticated("请先登录");
  }
  return req.auth.customerId;
}

function mapReview(r: ReviewDTO) {
  return {
    id: r.id,
    product_id: r.product_id,
    product_title: r.product_title,
    customer_name: r.customer_name,
    rating: r.rating,
    content: r.content,
    reply: r.reply,
    created_at: r.created_at,
  };
}

export function storeReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  /**
   * 商品详情页的评价区。
   *
   * 用 handle 而不是 id：店面所有商品路由都以 handle 为对外标识，
   * 多一个 id 只会让前端在两套标识之间来回换。
   */
  app.get(
    "/api/v1/store/products/:handle/reviews",
    { schema: { querystring: listReviewsQuery } },
    async (req, reply) => {
      const { handle } = req.params as { handle: string };
      const q = req.query as { limit: number; offset: number };
      await resolveChannelId(deps, req);

      const listed = await deps.services.product.listProducts({
        handle,
        status: "published",
        limit: 1,
      });
      const summary = listed.items[0];
      if (!summary) throw errors.notFound(`product not found: ${handle}`);

      const res = await deps.services.review.listProductReviews(summary.id, {
        limit: q.limit,
        offset: q.offset,
      });
      reply.ok({
        summary: res.summary,
        items: res.items.map(mapReview),
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  /** 提交评价：淘宝也是「我的订单 → 评价」，一单一商品一条。 */
  app.post(
    "/api/v1/store/reviews",
    { preHandler: auth.customerAuth, schema: { body: createReviewBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createReviewBody>;
      const customerId = requireCustomerId(req);

      // 展示名取顾客资料，服务层负责脱敏（评价是公开内容，不能出现全名/邮箱）
      const customer = await deps.services.customer.retrieveCustomer(customerId).catch(() => null);
      const rawName =
        [customer?.first_name, customer?.last_name].filter(Boolean).join("") ||
        customer?.email ||
        customer?.phone ||
        "顾客";

      const review = await deps.services.review.createReview({
        orderId: b.order_id,
        productId: b.product_id,
        customerId,
        customerName: rawName,
        rating: b.rating,
        ...(b.content !== undefined ? { content: b.content } : {}),
      });
      reply.code(201).ok(mapReview(review));
    },
  );
}
