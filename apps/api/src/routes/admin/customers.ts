import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { mapOrder } from "../mappers.js";
import { auditEntry } from "../audit-context.js";

const listQuery = z.object({
  /** 按邮箱/姓名搜索（淘宝客户列表顶部的搜索框）。 */
  q: z.string().max(60).optional(),
  /** 按标签筛选（ADR-103）：分页与计数都按这个条件收敛。 */
  tag_id: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const tagBody = z.object({ name: z.string().min(1).max(20) });
const setTagsBody = z.object({ tag_ids: z.array(z.string().min(1).max(40)).max(50) });

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
        tagId: q.tag_id,
        limit: q.limit,
        offset: q.offset,
      });
      const ids = res.items.map((c) => c.id);
      const [stats, tagsByCustomer] = await Promise.all([
        deps.services.order.summarizeByCustomerIds(ids),
        deps.services.customer.listTagsByCustomerIds(ids),
      ]);
      const byId = new Map(stats.map((s) => [s.customer_id, s]));
      reply.ok({
        items: res.items.map((c) => {
          const s = byId.get(c.id);
          return {
            ...c,
            order_count: s?.order_count ?? 0,
            total_spent_minor: s?.total_spent_minor ?? 0n,
            last_order_at: s?.last_order_at ?? null,
            // 标签一次批量取（禁 N+1）
            tags: (tagsByCustomer[c.id] ?? []).map((t) => ({ id: t.id, name: t.name })),
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

  // ---- 会员标签（ADR-103）----

  /** 标签列表（带客户数，客户列表的筛选与打标共用）。 */
  app.get("/api/v1/admin/customer-tags", { preHandler: guard }, async (_req, reply) => {
    reply.ok({ items: await deps.services.customer.listTags() });
  });

  app.post(
    "/api/v1/admin/customer-tags",
    { preHandler: guard, schema: { body: tagBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof tagBody>;
      const tag = await deps.services.customer.createTag(b.name);
      await deps.audit.record(
        auditEntry(req, {
          action: "customer_tag.create",
          entityType: "customer_tag",
          entityId: tag.id,
          before: null,
          after: tag,
        }),
      );
      reply.code(201).ok(tag);
    },
  );

  /** 删标签：同时清掉客户身上的关联（历史客户不受影响）。 */
  app.delete("/api/v1/admin/customer-tags/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deps.services.customer.deleteTag(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "customer_tag.delete",
        entityType: "customer_tag",
        entityId: id,
        before: { id },
        after: null,
      }),
    );
    reply.ok({ id });
  });

  /** 某客户身上的标签（详情/打标回填）。 */
  app.get("/api/v1/admin/customers/:id/tags", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.ok({ items: await deps.services.customer.listCustomerTags(id) });
  });

  /** 覆盖式设置客户标签：传什么就是什么。 */
  app.put(
    "/api/v1/admin/customers/:id/tags",
    { preHandler: guard, schema: { body: setTagsBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof setTagsBody>;
      const tags = await deps.services.customer.setCustomerTags(id, b.tag_ids);
      await deps.audit.record(
        auditEntry(req, {
          action: "customer.tags_update",
          entityType: "customer",
          entityId: id,
          before: null,
          after: { tags: tags.map((t) => t.id) },
        }),
      );
      reply.ok({ items: tags });
    },
  );
}
