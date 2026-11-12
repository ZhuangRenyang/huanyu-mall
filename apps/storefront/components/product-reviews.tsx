import { Star } from 'lucide-react';
import { cn } from '@mall/ui';
import type { ProductReviewsView } from '@/lib/reviews';

export interface ProductReviewsProps {
  data: ProductReviewsView;
}

/** 星级：实心按评分取整，半星不做（淘宝也不做半星，避免顾客纠结 4.5 是几颗）。 */
function Stars({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'base' }) {
  const box = size === 'sm' ? 'size-3.5' : 'size-4';
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} 星`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(box, i <= Math.round(rating) ? 'fill-accent-orange text-accent-orange' : 'text-border-strong')}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function formatDay(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 商品详情页的「评价」区块（ADR-042）。
 *
 * 淘宝的位置是详情之后、参数之前：顾客看完商品介绍，接着看别人怎么说。
 * 没有评价时不藏起来 —— 明确写「还没有评价」比一片空白可信。
 */
export function ProductReviews({ data }: ProductReviewsProps) {
  const { items, summary } = data;

  return (
    <section className="mt-10" aria-labelledby="reviews-heading">
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 id="reviews-heading" className="text-xl">
          评价
        </h2>
        <span className="tabular text-sm text-muted-foreground">{summary.count} 条</span>
      </div>

      {summary.count === 0 || summary.average === null ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          还没有评价。买过的顾客确认收货后可以在这里评价。
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[3fr_9fr]">
          {/* 左：总评分 + 星级分布（顾客先看「几分」，再看具体说了什么） */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-3xl font-semibold text-foreground">
                {summary.average.toFixed(1)}
              </span>
              <span className="text-sm text-muted-foreground">/ 5</span>
            </div>
            <div className="mt-1">
              <Stars rating={summary.average} size="base" />
            </div>
            <ul className="mt-4 space-y-1.5">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = summary.distribution[String(star)] ?? 0;
                const pct = summary.count > 0 ? Math.round((n / summary.count) * 100) : 0;
                return (
                  <li key={star} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-8 shrink-0 tabular">{star} 星</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-accent-orange"
                        style={{ width: `${pct}%` }}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular">{n}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 右：评价正文（最新在前） */}
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {items.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-foreground">{r.customerName}</span>
                  <Stars rating={r.rating} />
                  <span className="text-xs text-muted-foreground">{formatDay(r.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-sm leading-6 text-foreground">
                  {r.content.trim() || '此用户没有填写评价'}
                </p>
                {r.reply && (
                  <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-foreground">商家回复：</span>
                    {r.reply}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
