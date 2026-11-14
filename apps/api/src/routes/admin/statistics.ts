import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/**
 * 后台统计（ADR-097，对齐 CRMEB「统计」与淘宝「数据中心」）。
 *
 * 与工作台（看今天）不同，统计看的是**一段时间**的生意：
 *   1. 近 30 天交易汇总（销售额 / 订单数 / 退款额 / 客单价）
 *   2. 订单状态分布（一次 GROUP BY）
 *   3. 商品销量排行 top 10（变体维度聚合）
 *
 * 金额一律 minor unit 下发，前端只格式化不算账（铁律 13）。
 */

/** 近 30 天（统计报表默认窗口）。 */
function last30Days(now = new Date()): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  return { from, to };
}

export function adminStatisticsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("orders")];

  app.get("/api/v1/admin/statistics", { preHandler: guard }, async (_req, reply) => {
    const { from, to } = last30Days();
    const [paid, refunds, statusCounts, topVariants] = await Promise.all([
      deps.services.order.summarizePaidBetween(from, to),
      deps.services.order.summarizeRefundsBetween(from, to),
      deps.services.order.countByStatus(),
      deps.services.order.topSellingVariants(10),
    ]);

    // 商品销量排行：变体标题来自 product 模块，一次批量查，禁 N+1
    const variants = topVariants.length
      ? await deps.services.product.listVariantsByIds(topVariants.map((v) => v.variantId))
      : [];
    const titleByVariant = new Map(variants.map((v) => [v.id, v.title || v.sku]));

    const orderCount = paid.count;
    const salesMinor = paid.amountMinor;
    const refundMinor = refunds.amountMinor;
    const netMinor = salesMinor - refundMinor > 0n ? salesMinor - refundMinor : 0n;

    reply.ok({
      window: { from: from.toISOString(), to: to.toISOString(), days: 30 },
      currency_code: paid.currencyCode ?? "CNY",
      sales: {
        orders: orderCount,
        sales_minor: Number(salesMinor),
        refunds_minor: Number(refundMinor),
        net_minor: Number(netMinor),
        // 客单价 = 销售额 / 订单数；没单时 0（避免除零）
        avg_order_minor: orderCount > 0 ? Math.round(Number(salesMinor) / orderCount) : 0,
      },
      order_status_counts: statusCounts,
      top_products: topVariants.map((v) => ({
        variant_id: v.variantId,
        title: titleByVariant.get(v.variantId) ?? v.variantId,
        sold_quantity: v.quantity,
      })),
    });
  });
}
