import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { checkHealth } from "../../services/health.js";
import { cancelOrderAndReleaseStock } from "../../lib/cancel-order.js";
import { isStaleUnpaid } from "../../lib/stale-orders.js";

/**
 * 维护（ADR-076）：对齐 CRMEB「设置 → 维护」那一组。
 *
 * 商家不该为了看一眼「数据库通不通、邮件堵没堵」去翻日志文件或问开发。
 * 这里只读，不提供任何破坏性动作：
 * - 运行状态复用 `/api/v1/health` 的同一套探针（数据库 / Redis / 队列 / 最新迁移）；
 * - 邮件队列给待发 / 失败 / 已发三个数，堵住时能立刻看到；
 * - 数据规模给订单 / 商品 / 客户三个总数，判断「这是不是一个活店」；
 * - 最近审计流水拿 10 条，出了事能顺着时间往回看。
 *
 * 为什么不做「刷新缓存 / 清除数据 / 在线升级」：本仓没有页面缓存层，
 * 也没有远程升级通道。放三个点了没反应的按钮，比没有这个页面更坏。
 */
export function adminMaintenanceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  // 维护页是管理员视角（含系统探针与审计），与审计日志同权限
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get("/api/v1/admin/maintenance/status", { preHandler: guard }, async (_req, reply) => {
    const [health, mailPending, mailFailed, mailSent, orders, products, customers, audit] =
      await Promise.all([
        checkHealth(deps.config),
        deps.services.notification.list({ limit: 1, offset: 0, status: "pending" }),
        deps.services.notification.list({ limit: 1, offset: 0, status: "failed" }),
        deps.services.notification.list({ limit: 1, offset: 0, status: "sent" }),
        deps.services.order.listOrderSummaries({ limit: 1, offset: 0 }),
        deps.services.product.listProducts({ limit: 1, offset: 0 }),
        deps.services.customer.listCustomers({ limit: 1, offset: 0 }),
        deps.audit.query({ limit: 10, offset: 0 }),
      ]);

    reply.ok({
      system: {
        ...health,
        node: process.version,
        env: process.env.NODE_ENV ?? "development",
        now: new Date().toISOString(),
      },
      mail: {
        pending: mailPending.count,
        failed: mailFailed.count,
        sent: mailSent.count,
      },
      data: {
        orders: orders.count,
        products: products.count,
        customers: customers.count,
      },
      audit: {
        count: audit.count,
        // 只回最近 10 条：维护页是「扫一眼有没有异常」，不是审计分析工具
        recent: audit.items,
      },
    });
  });

  /**
   * 清理超时未付款订单（ADR-087）。
   *
   * 人工触发，不做定时任务：未付款取消只释放库存、不涉及钱，
   * 但「无人值守改状态」仍要单独评估；现在是商家点一下、最多 100 单。
   */
  app.post("/api/v1/admin/maintenance/expire-unpaid", { preHandler: guard }, async (req, reply) => {
    const body = (req.body ?? {}) as { minutes?: number };
    const minutes = Math.min(Math.max(Math.floor(Number(body.minutes ?? 30)), 1), 43_200);
    const now = new Date();

    const res = await deps.services.order.listOrderSummaries({
      statuses: ["pending", "awaiting_payment"],
      limit: 100,
      offset: 0,
    });
    const stale = res.items.filter((o) => isStaleUnpaid(o.status, o.placed_at, now, minutes));

    let released = 0;
    for (const order of stale) {
      await cancelOrderAndReleaseStock(deps, order.id);
      released += 1;
    }

    if (released > 0) {
      await deps.audit.record({
        actorType: "admin",
        actorId: "maintenance",
        action: "order.expire_unpaid",
        entityType: "order",
        entityId: null,
        after: { released, minutes },
        ip: null,
        userAgent: null,
        requestId: req.id,
      });
    }
    reply.ok({ scanned: res.items.length, canceled: released, minutes });
  });
}