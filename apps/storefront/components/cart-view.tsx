'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag, TicketPercent, Trash2 } from 'lucide-react';
import { Button, EmptyState, IconButton, QuantityStepper, formatMoney } from '@mall/ui';
import { useCart } from '@/lib/cart-store';
import { getAccessToken } from '@/lib/account';
import { fetchMyVouchers, voucherValueText, type MyVoucherView } from '@/lib/vouchers';

/** 购物车页面：行编辑 + 数量增减 + 金额汇总 + 空态。移动吸底结构，桌面 8:4 两栏。 */
export function CartView({ locale, channel }: { locale: string; channel: string }) {
  const router = useRouter();
  const { items, count, subtotal, updateQuantity, removeItem } = useCart();
  const base = `/${locale}/${channel}`;
  /** 我的卡券：顾客领了券但购物车不提示，等于白领（ADR-035）。 */
  const [vouchers, setVouchers] = useState<MyVoucherView[]>([]);

  useEffect(() => {
    // 游客不请求：没有账号就没有卡券包
    if (!getAccessToken()) return;
    let cancelled = false;
    void fetchMyVouchers()
      .then((res) => {
        if (!cancelled) setVouchers(res.items);
      })
      .catch(() => {
        /* 拉不到券不影响购物车 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-content px-4 py-12">
        <EmptyState
          icon={ShoppingBag}
          title="购物车还是空的"
          description="看看当季新品"
          action={<Button onClick={() => router.push(`${base}/products`)}>去逛逛</Button>}
        />
      </div>
    );
  }

  const usable = vouchers.filter((v) => v.status === 'unused' && !v.expired);
  const reachable = usable.filter((v) => !v.minSpentMinor || subtotal.amountMinor >= v.minSpentMinor);
  // 差一点点就能用的那张：提示「再买 X」，比罗列所有券更能促成下单
  const nearest = usable
    .filter((v) => v.minSpentMinor !== null && subtotal.amountMinor < v.minSpentMinor)
    // 门槛最低的那张：最容易凑到
    .sort((a, b) => (a.minSpentMinor ?? 0) - (b.minSpentMinor ?? 0))[0];

  return (
    <div className="mx-auto max-w-content px-4 py-6 md:py-8">
      <h1 className="mb-6 text-xl md:text-2xl">购物车（{count}）</h1>

      <div className="grid gap-8 lg:grid-cols-[8fr_4fr]">
        <ul className="divide-y divide-border border-y border-border">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 py-4">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  loading="lazy"
                  className="aspect-square w-20 shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className="aspect-square w-20 shrink-0 rounded-md bg-secondary" aria-hidden="true" />
              )}

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="line-clamp-2-safe text-sm text-foreground">{item.title}</p>
                    {item.variantTitle && <p className="text-xs text-muted-foreground">{item.variantTitle}</p>}
                  </div>
                  <IconButton aria-label={`移除 ${item.title}`} size="sm" onClick={() => removeItem(item.id)}>
                    <Trash2 className="size-5" strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                </div>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <QuantityStepper
                    value={item.quantity}
                    max={item.maxQuantity}
                    onChange={(q) => updateQuantity(item.id, q)}
                    decreaseLabel={`减少 ${item.title} 数量`}
                    increaseLabel={`增加 ${item.title} 数量`}
                  />
                  <span className="tabular text-base font-medium">
                    {formatMoney(item.unitPriceMinor * item.quantity, item.currencyCode)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="lg:sticky lg:top-[calc(var(--chrome-offset)+1rem)] lg:self-start">
          <div className="space-y-3 rounded-lg border border-border bg-card p-5">
            <h2 className="text-base font-semibold">订单摘要</h2>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">小计</span>
              <span className="tabular">{formatMoney(subtotal.amountMinor, subtotal.currencyCode)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">运费</span>
              {/* 运费按收货国家与店铺规则算，购物车还不知道国家 —— 不承诺一个可能错的数字 */}
              <span className="text-muted-foreground">结算时按国家计算</span>
            </div>
            {(reachable.length > 0 || nearest) && (
              <p className="flex items-start gap-1.5 rounded-md bg-primary-subtle px-3 py-2 text-xs text-primary-subtle-foreground">
                <TicketPercent className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                {reachable.length > 0
                  ? `有 ${reachable.length} 张优惠券可用，结算时选择`
                  : `再买 ${formatMoney(
                      (nearest!.minSpentMinor ?? 0) - subtotal.amountMinor,
                      subtotal.currencyCode,
                    )} 可用「${voucherValueText(nearest!, subtotal.currencyCode)}」券`}
              </p>
            )}
            <div className="flex justify-between border-t border-border pt-3 text-base font-semibold">
              <span>合计</span>
              <span className="tabular">{formatMoney(subtotal.amountMinor, subtotal.currencyCode)}</span>
            </div>
            <Button size="lg" className="w-full" onClick={() => router.push(`${base}/checkout`)}>
              去结算
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
