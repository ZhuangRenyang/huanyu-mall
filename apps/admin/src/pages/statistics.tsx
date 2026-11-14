import { useEffect, useState } from 'react';
import { BarChart3, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { formatMoney } from '@mall/ui';
import { getStatistics, type StatisticsView } from '@/lib/admin-statistics';

/**
 * 统计报表（ADR-097，对齐 CRMEB「统计」与淘宝「数据中心」）。
 *
 * 与工作台（看今天）不同，统计看的是**近 30 天**的生意：
 * 销售额 / 订单数 / 退款额 / 客单价，加订单状态分布与商品销量排行。
 * 金额由后端算好下发，前端只格式化（铁律 13）。
 */

const STATUS_LABEL: Record<string, string> = {
  pending: '待付款',
  awaiting_payment: '待付款',
  paid: '已付款',
  partially_fulfilled: '部分发货',
  fulfilled: '已发货',
  delivered: '已签收',
  completed: '已完成',
  refund_pending: '退款中',
  refunded: '已退款',
  canceled: '已取消',
};

export function StatisticsPage() {
  const [data, setData] = useState<StatisticsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getStatistics()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, []);

  if (error) {
    return <p className="text-sm text-destructive" role="alert">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  const currency = data.currencyCode;
  const statusEntries = Object.entries(data.orderStatusCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">统计</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          近 30 天的交易汇总与商品排行，金额以后端为准。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={Wallet}
          label="销售额"
          value={formatMoney(data.sales.salesMinor, currency)}
          sub={`${data.sales.orders} 笔订单`}
        />
        <MetricCard
          icon={Receipt}
          label="退款额"
          value={formatMoney(data.sales.refundsMinor, currency)}
          sub={`净收入 ${formatMoney(data.sales.netMinor, currency)}`}
        />
        <MetricCard
          icon={TrendingUp}
          label="客单价"
          value={formatMoney(data.sales.avgOrderMinor, currency)}
          sub="销售额 ÷ 订单数"
        />
        <MetricCard
          icon={BarChart3}
          label="订单状态"
          value={String(statusEntries.length)}
          sub="种状态"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 订单状态分布 */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">订单状态分布</h2>
          {statusEntries.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">还没有订单。</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {statusEntries.map(([status, count]) => (
                <li key={status} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{STATUS_LABEL[status] ?? status}</span>
                  <span className="tabular font-medium text-foreground">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 商品销量排行 */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">商品销量排行（累计）</h2>
          {data.topProducts.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">还没有成交。</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {data.topProducts.map((p, i) => (
                <li key={p.variantId} className="flex items-center gap-2 text-sm">
                  <span className="w-5 shrink-0 tabular text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{p.title}</span>
                  <span className="shrink-0 tabular text-muted-foreground">× {p.soldQuantity}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </section>
  );
}
