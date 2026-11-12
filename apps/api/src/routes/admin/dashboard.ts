import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/**
 * 后台工作台（ADR-030）。
 *
 * 对齐淘宝「首页」与 Shopify Home：商家进门第一眼是**今天做了多少生意、有多少事要处理**，
 * 而不是一屏商品列表。所以这个接口一次性给出四件事：
 *   1. 今日支付金额与支付订单数（口径：payment_status=paid 且今天创建）
 *   2. 待发货订单数（已付款但没发完）
 *   3. 待处理退款单数
 *   4. 最近 5 笔订单
 *
 * 金额用 minor unit 传给前端，前端只格式化不算账。
 */

/** 待发货：付过款但还没发完（淘宝「待发货」的口径）。 */
const TO_FULFILL_STATUSES = ["paid", "partially_fulfilled"];

/** 今日零点（服务器本地时区）：商家理解的「今天」是自己店里的今天。 */
function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function adminDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  // 工作台看的是订单与售后，有 orders 权限即可（staff 也能看）
  const guard = [auth.adminAuth, auth.requirePermission("orders")];

  app.get("/api/v1/admin/dashboard", { preHandler: guard }, async (_req, reply) => {
    const since = startOfToday();
    const [paid, statusCounts, refunds, recent] = await Promise.all([
      deps.services.order.summarizePaidSince(since),
      deps.services.order.countByStatus(),
      // 只要计数：limit=1 拿 counts，不把单据全查出来
      deps.services.order.listRefundRequests({ status: "pending", limit: 1, offset: 0 }),
      deps.services.order.listOrders({ limit: 5, offset: 0 }),
    ]);

    const toFulfill = TO_FULFILL_STATUSES.reduce((sum, s) => sum + (statusCounts[s] ?? 0), 0);

    reply.ok({
      today: {
        paid_orders: paid.count,
        paid_amount_minor: Number(paid.amountMinor),
        // 单币种店铺为主：金额按最近一笔已付订单的币种展示，没单时退回店铺默认
        currency_code: paid.currencyCode ?? "CNY",
      },
      pending: {
        to_fulfill: toFulfill,
        refunds: refunds.counts?.pending ?? refunds.count ?? 0,
      },
      order_status_counts: statusCounts,
      recent_orders: recent.items.map((o) => ({
        id: o.id,
        status: o.status,
        payment_status: o.payment_status,
        email: o.email,
        total_minor: Number(o.total_minor),
        currency_code: o.currency_code,
        placed_at: o.placed_at,
        customer_id: o.customer_id ?? null,
      })),
    });
  });
}
