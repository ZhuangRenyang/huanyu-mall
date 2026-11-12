import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, PackageCheck, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import { Badge, Skeleton, formatMoney } from '@mall/ui';
import { getDashboard, type DashboardView } from '@/lib/admin-dashboard';

/**
 * 后台工作台（ADR-030）。
 *
 * 位置照淘宝/Shopify：菜单第一项、登录后的落地页。
 * 商家进门要能立刻回答四个问题：今天卖了多少、有多少单要发、有多少退款要审、最近谁下了单。
 *
 * 只做「看得见」：不做趋势图、不做同比环比 —— 那些要按天聚合与历史对照，
 * 属于有数据积累之后的第二步。
 */
export function DashboardPage() {
  const [data, setData] = useState<DashboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await getDashboard());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取工作台数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error ?? '读取工作台数据失败'}
      </p>
    );
  }

  const { today, pending, recentOrders } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">工作台</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          今日数据口径：今天 0 点之后付款成功的订单（未付款与已退款的不计入金额）。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={Wallet}
          label="今日支付金额"
          value={formatMoney(today.paidAmountMinor, today.currencyCode)}
          hint={`${today.paidOrders} 笔已付款订单`}
          tone="brand"
        />
        <MetricCard
          icon={ShoppingBag}
          label="今日支付订单"
          value={String(today.paidOrders)}
          hint="按付款成功统计"
        />
        <MetricCard
          icon={PackageCheck}
          label="待发货"
          value={String(pending.toFulfill)}
          hint={pending.toFulfill > 0 ? '付过款还没发完' : '没有积压'}
          href="/orders?filter=unfulfilled"
          actionLabel="去发货"
        />
        <MetricCard
          icon={Receipt}
          label="待处理退款"
          value={String(pending.refunds)}
          hint={pending.refunds > 0 ? '顾客在等回复' : '没有待审单据'}
          href="/refunds"
          actionLabel="去审核"
          tone={pending.refunds > 0 ? 'warn' : 'plain'}
        />
      </div>

      <section aria-labelledby="recent-orders-heading" className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="recent-orders-heading" className="text-sm font-semibold text-foreground">
            最近订单
          </h2>
          <Link
            to="/orders"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            查看全部
            <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">还没有订单</p>
        ) : (
          <ul className="divide-y divide-border">
            {recentOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <Link
                    to={`/orders?q=${encodeURIComponent(o.id)}`}
                    className="text-sm font-medium text-foreground hover:underline"
                  >
                    {o.id}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.email}
                    {o.placedAt ? ` · ${new Date(o.placedAt).toLocaleString('zh-CN')}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge paymentStatus={o.paymentStatus} status={o.status} />
                  <span className="tabular text-sm font-medium text-foreground">
                    {formatMoney(o.totalMinor, o.currencyCode)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  href,
  actionLabel,
  tone = 'plain',
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint: string;
  href?: string;
  actionLabel?: string;
  tone?: 'plain' | 'brand' | 'warn';
}) {
  return (
    <section
      className={
        tone === 'warn'
          ? 'rounded-lg border border-accent-orange/60 bg-accent-orange/5 p-4'
          : 'rounded-lg border border-border bg-card p-4'
      }
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
        {label}
      </div>
      <p
        className={
          tone === 'brand'
            ? 'tabular mt-2 text-2xl font-semibold text-accent-orange-deep'
            : 'tabular mt-2 text-2xl font-semibold text-foreground'
        }
      >
        {value}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{hint}</span>
        {href && actionLabel && (
          <Link
            to={href}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            {actionLabel}
            <ArrowRight className="size-3" strokeWidth={2} aria-hidden="true" />
          </Link>
        )}
      </div>
    </section>
  );
}

/** 订单状态：先看付款，再看履约（与订单列表口径一致）。 */
function StatusBadge({ paymentStatus, status }: { paymentStatus: string; status: string }) {
  if (paymentStatus !== 'paid') {
    return (
      <Badge variant="neutral">
        <AlertCircle className="mr-1 size-3" strokeWidth={2} aria-hidden="true" />
        未付款
      </Badge>
    );
  }
  if (status === 'refund_pending' || status === 'refunded') {
    return <Badge variant="warning">{status === 'refunded' ? '已退款' : '退款中'}</Badge>;
  }
  if (status === 'fulfilled' || status === 'delivered' || status === 'completed') {
    return <Badge variant="success">已发货</Badge>;
  }
  return <Badge variant="brand">待发货</Badge>;
}
