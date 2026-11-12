import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { mapOrder } from "../mappers.js";

const listQuery = z.object({
  /** 按邮箱/姓名搜索（淘宝客户列表顶部的搜索框）。 */
  q: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

/**
 * 后台客户管理（对齐淘宝「客户运营 → 客户列表」/ Shopify「Customers」）。
 *
 * 注册与登录在**店面**完成，后台只做查看：客户资料、地址、订单与消费。
 * 后台不提供「代客注册」这类入口 —— 成熟系统都没有，属于自创功能。
 */
export function adminCustomerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("customers")];

  /**
   * 客户列表。
   *
   * 订单数 / 累计消费 / 最近下单由 order 模块一次 GROUP BY 算好再合并：
   * 逐个客户查订单就是 N+1，客户上百之后列表会明显卡。
   */
  app.get(
    "/api/v1/admin/customers",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const res = await deps.services.customer.listCustomers({
        q: q.q,
        limit: q.limit,
        offset: q.offset,
      });
      const stats = await deps.services.order.summarizeByCustomerIds(res.items.map((c) => c.id));
      const byId = new Map(stats.map((s) => [s.customer_id, s]));
      reply.ok({
        items: res.items.map((c) => {
          const s = byId.get(c.id);
          return {
            ...c,
            order_count: s?.order_count ?? 0,
            total_spent_minor: s?.total_spent_minor ?? 0n,
            last_order_at: s?.last_order_at ?? null,
          };
        }),
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  /**
   * 客户详情：资料 + 地址 + 最近订单。
   *
   * 订单只取最近 10 条：详情页是「了解这个人」，不是订单管理；
   * 要看全部订单去「订单列表」按邮箱搜。
   */
  app.get("/api/v1/admin/customers/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const customer = await deps.services.customer.retrieveCustomer(id);
    const [addresses, orders, stats] = await Promise.all([
      deps.services.customer.listAddresses(id),
      deps.services.order.listOrderSummaries({ customerId: id, limit: 10, offset: 0 }),
      deps.services.order.summarizeByCustomerIds([id]),
    ]);
    const summary = stats[0];
    reply.ok({
      ...customer,
      addresses,
      orders: orders.items.map(mapOrder),
      order_count: summary?.order_count ?? 0,
      total_spent_minor: summary?.total_spent_minor ?? 0n,
      last_order_at: summary?.last_order_at ?? null,
    });
  });
}
