'use client';

import { useCallback, useEffect, useState } from 'react';
import { TicketPercent } from 'lucide-react';
import { Badge, Skeleton, cn } from '@mall/ui';
import {
  fetchMyVouchers,
  voucherThresholdText,
  voucherValueText,
  type MyVoucherView,
} from '@/lib/vouchers';

/**
 * 我的卡券（账户页，ADR-029）。
 *
 * 淘宝的路径是「我的淘宝 → 卡券包」；这里放在账户页，和地址簿同级 ——
 * 都是「顾客自己的资料」，不是订单的一部分。
 *
 * 状态只有三种：可用 / 已用 / 已过期。过期由 ends_at 现算，
 * 后端不落「已过期」状态（落了还得跑定时任务去改，纯属自找麻烦）。
 */
export function MyVouchers() {
  const [items, setItems] = useState<MyVoucherView[]>([]);
  const [currencyCode, setCurrencyCode] = useState('CNY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchMyVouchers();
      setItems(res.items);
      setCurrencyCode(res.currencyCode);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取卡券失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const usable = items.filter((v) => v.status === 'unused' && !v.expired);
  const others = items.filter((v) => v.status === 'used' || v.expired);

  return (
    <section aria-labelledby="my-vouchers-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="my-vouchers-heading" className="text-base font-semibold">
          我的卡券
        </h2>
        {usable.length > 0 && <Badge variant="brand">{usable.length} 张可用</Badge>}
      </div>

      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          还没有卡券。商品页上的「领取」按钮可以把店铺券放进这里。
        </p>
      ) : (
        <ul className="space-y-2">
          {[...usable, ...others].map((v) => {
            const disabled = v.status === 'used' || v.expired;
            return (
              <li
                key={v.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
                  disabled ? 'border-border bg-muted' : 'border-accent-orange/60 bg-card',
                )}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span
                      className={cn(
                        'font-semibold',
                        disabled ? 'text-muted-foreground' : 'text-accent-orange-deep',
                      )}
                    >
                      {voucherValueText(v, currencyCode)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {voucherThresholdText(v.minSpentMinor, currencyCode)}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {v.name}
                    {v.scopeLabel ? ` · ${v.scopeLabel}` : ''}
                  </p>
                  {!disabled && (
                    <p className="mt-0.5 text-xs text-muted-foreground">结账时自动可选，无需输码</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {v.status === 'used' ? (
                    <Badge variant="neutral">已使用</Badge>
                  ) : v.expired ? (
                    <Badge variant="neutral">已过期</Badge>
                  ) : (
                    <Badge variant="brand">可用</Badge>
                  )}
                  {v.endsAt && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.endsAt).toLocaleDateString('zh-CN')} 到期
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {items.length === 0 && !loading && !error && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <TicketPercent className="size-3.5" strokeWidth={2} aria-hidden="true" />
          店铺做活动时，商品页会出现可领取的优惠券
        </p>
      )}
    </section>
  );
}
