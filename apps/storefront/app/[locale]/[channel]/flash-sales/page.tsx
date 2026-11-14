import { Zap } from 'lucide-react';
import { Badge, formatMoney } from '@mall/ui';
import { loadActiveFlashSales } from '@/lib/flash-sales';

/**
 * 限时秒杀（ADR-099）。
 *
 * 只展示进行中、还有剩余的活动：售完即从列表消失，避免「点进去没货」。
 * 秒杀价由服务端在结账时按购物车真实单价重算，展示价只作参考。
 */
export default async function FlashSalesPage() {
  const sales = await loadActiveFlashSales();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center gap-2">
        <Zap className="size-5 text-accent-orange" strokeWidth={2} aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground">限时秒杀</h1>
      </header>
      <p className="mt-1 text-sm text-muted-foreground">
        活动价限时限量，卖完即止；加入购物车后按秒杀价结算。
      </p>

      {sales.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-foreground">暂时没有进行中的秒杀</p>
          <p className="mt-1 text-xs text-muted-foreground">关注本页，下一场开始时会出现在这里</p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {sales.map((sale) => (
            <section key={sale.id} aria-labelledby={`sale-${sale.id}`}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 id={`sale-${sale.id}`} className="text-lg font-medium text-foreground">
                  {sale.name}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {formatWindow(sale.startsAt, sale.endsAt)}
                </span>
              </div>

              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sale.items.map((item) => {
                  const pct = item.stock > 0 ? Math.round((item.sold / item.stock) * 100) : 0;
                  return (
                    <li
                      key={item.id}
                      className="rounded-lg border border-border bg-card p-4"
                    >
                      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-foreground">{item.title}</p>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="tabular text-lg font-semibold text-accent-orange">
                          {formatMoney(item.flashPriceMinor, 'CNY')}
                        </span>
                        <span className="tabular text-xs text-muted-foreground line-through">
                          {formatMoney(item.originalPriceMinor, 'CNY')}
                        </span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-accent-orange"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <p className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                        <span>已抢 {item.sold} 件</span>
                        <Badge variant={item.remaining <= 5 ? 'destructive' : 'neutral'}>
                          剩 {item.remaining}
                        </Badge>
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** 活动时间窗：不是给人读「2026-11-14T10:00:00Z」，只说到「至 11-15 22:00」。 */
function formatWindow(startsAt: string, endsAt: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `${fmt(startsAt)} 至 ${fmt(endsAt)}`;
}
