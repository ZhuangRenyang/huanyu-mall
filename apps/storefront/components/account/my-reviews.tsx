'use client';

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { Skeleton } from '@mall/ui';
import { listMyReviews, type MyReviewView } from '@/lib/reviews';
import { formatDateTime } from '@/lib/orders';

/**
 * 我的评价（ADR-054）。
 *
 * 淘宝把「评价管理」放在我的淘宝里：写过的评价、商家有没有回复、还在不在展示。
 * 之前顾客写完就再也看不到了 —— 想确认「我是不是评过这件」，只能去翻订单。
 *
 * 被商家隐藏的评价也列出来，并标「仅自己可见」：
 * 顾客有权知道自己的评价没有出现在商品页，而不是以为它凭空消失。
 */
export function MyReviews() {
  const [items, setItems] = useState<MyReviewView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listMyReviews()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取评价失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="my-reviews-heading" className="rounded-lg border border-border bg-card p-4">
      <h2 id="my-reviews-heading" className="text-base font-semibold text-foreground">
        我的评价
      </h2>

      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {!items && !error && (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {items && items.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          还没有写过评价。订单确认收货后，可以在「我的订单」里给商品打分。
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {items.map((r) => (
            <li key={r.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {r.productTitle}
                </span>
                {!r.visible && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    仅自己可见
                  </span>
                )}
                <span className="tabular text-xs text-muted-foreground">
                  {formatDateTime(r.createdAt)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-0.5" aria-label={`评分 ${r.rating} 分`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={
                      n <= r.rating
                        ? 'size-3.5 fill-accent-orange text-accent-orange'
                        : 'size-3.5 text-muted-foreground'
                    }
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ))}
              </div>
              {r.content && <p className="mt-1 text-sm text-foreground">{r.content}</p>}
              {r.reply && (
                <p className="mt-1 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                  商家回复：{r.reply}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
