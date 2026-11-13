'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ShoppingBag, TicketPercent, Trash2 } from 'lucide-react';
import {
  Button,
  EmptyState,
  IconButton,
  QuantityStepper,
  formatMoney,
  type CartLineItemProps,
} from '@mall/ui';
import { useCart } from '@/lib/cart-store';
import { getAccessToken } from '@/lib/account';
import { fetchMyVouchers, voucherValueText, type MyVoucherView } from '@/lib/vouchers';

/**
 * 购物车页面：行编辑 + 数量增减 + 金额汇总 + 空态。移动吸底结构，桌面 8:4 两栏。
 *
 * 失效宝贝（ADR-062）：商品下架 / 售罄后，车里的那一行看起来仍像正常商品，
 * 顾客点结算才失败 —— 那时购物车已经关了，他看不到是哪件出了问题。
 * 所以按淘宝的做法把它们分到下方独立的「失效宝贝」组：标灰、不能改数量、
 * 一键移出，且**不放行结算**。
 */

/** 失效 = 买不了（下架 / 售罄）。库存不足不算失效：商品还在，只是数量要改小。 */
function isInvalid(item: CartLineItemProps): boolean {
  return item.availabilityStatus === 'delisted' || item.availabilityStatus === 'out_of_stock';
}

function reasonText(item: CartLineItemProps): string | null {
  switch (item.availabilityStatus) {
    case 'delisted':
      return '商品已下架';
    case 'out_of_stock':
      return '已售罄';
    case 'insufficient':
      return `仅剩 ${item.availableQuantity ?? 0} 件`;
    default:
      return null;
  }
}

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

  const invalid = items.filter(isInvalid);
  const valid = items.filter((item) => !isInvalid(item));
  const hasInvalid = invalid.length > 0;

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
        <div>
          {valid.length > 0 ? (
            <ul className="divide-y divide-border border-y border-border">
              {valid.map((item) => {
                const reason = reasonText(item);
                return (
                  <li key={item.id} className="flex gap-3 py-4">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        loading="lazy"
                        className="aspect-square w-20 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div
                        className="aspect-square w-20 shrink-0 rounded-md bg-secondary"
                        aria-hidden="true"
                      />
                    )}

                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="line-clamp-2-safe text-sm text-foreground">{item.title}</p>
                          {item.variantTitle && (
                            <p className="text-xs text-muted-foreground">{item.variantTitle}</p>
                          )}
                          {/* 库存不足：商品还能买，只是数量超过库存，提示顾客自己改小 */}
                          {reason && (
                            <p className="mt-1 text-xs text-destructive" role="status">
                              {reason}
                            </p>
                          )}
                        </div>
                        <IconButton
                          aria-label={`移除 ${item.title}`}
                          size="sm"
                          onClick={() => removeItem(item.id)}
                        >
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
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="购物车里的商品都买不了了"
              description="它们已下架或售罄，移出后可以继续逛逛"
              action={<Button onClick={() => router.push(`${base}/products`)}>去逛逛</Button>}
            />
          )}

          {/* 失效宝贝：淘宝放在购物车最下方，独立成组、不参与结算 */}
          {hasInvalid && (
            <section aria-labelledby="invalid-heading" className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                <h2 id="invalid-heading" className="text-sm font-medium text-foreground">
                  失效宝贝（{invalid.length}）
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  // 逐行调用既有删除接口：不新开批量端点，避免绕过每行的归属校验
                  onClick={() => invalid.forEach((item) => removeItem(item.id))}
                >
                  移出失效宝贝
                </Button>
              </div>
              <ul className="divide-y divide-border">
                {invalid.map((item) => (
                  <li key={item.id} className="flex gap-3 py-4">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-20 shrink-0 rounded-md object-cover opacity-50 grayscale"
                      />
                    ) : (
                      <div
                        className="aspect-square w-20 shrink-0 rounded-md bg-secondary"
                        aria-hidden="true"
                      />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="line-clamp-2-safe text-sm text-muted-foreground">
                            {item.title}
                          </p>
                          {item.variantTitle && (
                            <p className="text-xs text-muted-foreground">{item.variantTitle}</p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {reasonText(item)}
                            {item.quantity > 1 ? ` · ${item.quantity} 件` : ''}
                          </p>
                        </div>
                        <IconButton
                          aria-label={`移除 ${item.title}`}
                          size="sm"
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="size-5" strokeWidth={2} aria-hidden="true" />
                        </IconButton>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

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
            {hasInvalid && (
              // 钱一律服务端算（铁律 13）：这里不自己扣减失效商品，只说明并让他移除后重算
              <p className="flex items-start gap-1.5 rounded-md bg-warning-subtle px-3 py-2 text-xs text-foreground">
                <AlertCircle
                  className="mt-0.5 size-3.5 shrink-0 text-warning"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                小计含 {invalid.length} 件失效宝贝，移出后金额会自动重算。
              </p>
            )}
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
            <Button
              size="lg"
              className="w-full"
              disabled={hasInvalid}
              onClick={() => router.push(`${base}/checkout`)}
            >
              {hasInvalid ? '请先移出失效宝贝' : '去结算'}
            </Button>
            {hasInvalid && (
              <p className="text-xs text-muted-foreground">
                失效商品无法下单，移出后即可结算。
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
