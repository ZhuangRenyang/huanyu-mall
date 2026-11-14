import { adminClient, getAdminApiMode } from './admin-client';

/** 统计报表（ADR-097）：近 30 天交易汇总 + 状态分布 + 销量排行。 */
export interface StatisticsView {
  sales: {
    orders: number;
    salesMinor: number;
    refundsMinor: number;
    netMinor: number;
    avgOrderMinor: number;
  };
  currencyCode: string;
  orderStatusCounts: Record<string, number>;
  topProducts: Array<{ variantId: string; title: string; soldQuantity: number }>;
}

export async function getStatistics(): Promise<StatisticsView> {
  if (getAdminApiMode() !== 'live') {
    return {
      sales: { orders: 0, salesMinor: 0, refundsMinor: 0, netMinor: 0, avgOrderMinor: 0 },
      currencyCode: 'CNY',
      orderStatusCounts: {},
      topProducts: [],
    };
  }
  const res = (await adminClient().getStatistics()) as {
    currency_code?: string;
    sales?: { orders?: number; sales_minor?: number; refunds_minor?: number; net_minor?: number; avg_order_minor?: number };
    order_status_counts?: Record<string, number>;
    top_products?: Array<{ variant_id: string; title: string; sold_quantity: number }>;
  };
  return {
    sales: {
      orders: Number(res.sales?.orders ?? 0),
      salesMinor: Number(res.sales?.sales_minor ?? 0),
      refundsMinor: Number(res.sales?.refunds_minor ?? 0),
      netMinor: Number(res.sales?.net_minor ?? 0),
      avgOrderMinor: Number(res.sales?.avg_order_minor ?? 0),
    },
    currencyCode: String(res.currency_code ?? 'CNY'),
    orderStatusCounts: res.order_status_counts ?? {},
    topProducts: (res.top_products ?? []).map((p) => ({
      variantId: p.variant_id,
      title: p.title,
      soldQuantity: Number(p.sold_quantity ?? 0),
    })),
  };
}
