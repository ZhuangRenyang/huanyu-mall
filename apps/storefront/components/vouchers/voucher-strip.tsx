'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TicketPercent } from 'lucide-react';
import { Button, cn } from '@mall/ui';
import { getAccessToken } from '@/lib/account';
import {
  claimVoucher,
  voucherThresholdText,
  voucherValueText,
  type PublicVoucherView,
} from '@/lib/vouchers';

/**
 * 商品页券条（ADR-029）。
 *
 * 对齐淘宝：商品详情页在价格下方就摆着「满 199 减 20 · 领取」。
 * 顾客不用先知道有券这回事 —— 看到数字、点一下就进卡券包，结账自动可用。
 *
 * 未登录点领取先跳账户页：券必须落到某个人名下，这里不做「先记在本地、
 * 登录后再补」—— 那种半接状态最容易出现「领了却用不了」。
 */
export function VoucherStrip({
  vouchers,
  currencyCode,
  accountHref,
}: {
  vouchers: PublicVoucherView[];
  currencyCode: string;
  accountHref: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(vouchers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  const claim = async (id: string) => {
    if (!getAccessToken()) {
      router.push(accountHref);
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await claimVoucher(id);
      // 领完把本地状态改掉即可，不必整页刷新
      setItems((prev) =>
        prev.map((v) =>
          v.id === id ? { ...v, collected: true, collectedCount: res.alreadyCollected ? v.collectedCount : v.collectedCount + 1 } : v,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '领取失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="voucher-strip-heading" className="mt-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <TicketPercent className="size-4 text-accent-orange-deep" strokeWidth={2} aria-hidden="true" />
        <h2 id="voucher-strip-heading" className="text-sm font-medium text-foreground">
          店铺优惠券
        </h2>
      </div>

      <ul className="space-y-2">
        {items.map((v) => {
          const exhausted = v.collectedCount >= v.collectLimit;
          return (
            <li
              key={v.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2',
                exhausted ? 'border-border bg-muted' : 'border-accent-orange/60 bg-accent-orange/5',
              )}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-semibold text-accent-orange-deep">
                    {voucherValueText(v, currencyCode)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {voucherThresholdText(v.minSpentMinor, currencyCode)}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {v.name}
                  {v.type === 'specific_product'
                    ? ` · ${v.scopeLabel ?? '限指定商品'}`
                    : v.type === 'shipping'
                      ? ' · 仅抵运费'
                      : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant={exhausted ? 'secondary' : 'primary'}
                disabled={exhausted || busyId === v.id}
                onClick={() => void claim(v.id)}
                aria-label={exhausted ? `${v.name} 已领取` : `领取 ${v.name}`}
              >
                {exhausted ? '已领取' : busyId === v.id ? '领取中…' : '领取'}
              </Button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">领取后结账时自动可用，不必再输码。</p>
    </section>
  );
}
