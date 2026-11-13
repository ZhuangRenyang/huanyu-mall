'use client';

import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@mall/ui';
import { knownEmail, subscribeStockAlert } from '@/lib/stock-alerts';

/**
 * 到货提醒（ADR-059）。
 *
 * 售罄商品页此前是死胡同：顾客看到「已售罄」，能做的只有关页面。
 * 淘宝在售罄商品上给一个「到货提醒」，登记后补货发一封邮件 ——
 * 这是转化链条上最便宜的一环。
 *
 * 登录顾客不用再打一遍邮箱（账号里有），游客必须填。
 */
export function StockAlertForm({
  productId,
  variantId,
}: {
  productId: string;
  variantId: string;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; expiresAt: number | null; demo: boolean } | null>(null);

  // 登录了就预填账号邮箱：少一次输入
  useEffect(() => {
    const known = knownEmail();
    if (known) setEmail(known);
  }, []);

  if (done) {
    return (
      <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm" role="status">
        <p className="text-foreground">
          已登记：补货后会发邮件到 <span className="font-medium">{done.email}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {done.demo
            ? '演示模式：不会真的发送邮件，正式环境才会。'
            : '只在补货时发一封，不会重复打扰。'}
        </p>
        {/* 有效期（ADR-069）：登记不会一直有效，过期后要重新登记 */}
        {done.expiresAt && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            有效期至 {new Date(done.expiresAt).toLocaleDateString('zh-CN')}，过期后重新登记即可。
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <BellRing className="size-4" strokeWidth={2} aria-hidden="true" />
        到货提醒
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        这个规格暂时没货。留下邮箱，补货后我们发一封邮件给你（登记 30 天内有效）。
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="stock-alert-email" className="sr-only">
          邮箱
        </label>
        <input
          id="stock-alert-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          placeholder="you@example.com"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
        />
        <Button
          size="sm"
          disabled={busy || email.trim() === ''}
          onClick={() => {
            setBusy(true);
            setError(null);
            void subscribeStockAlert({ productId, variantId, email })
              .then(setDone)
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : '登记失败，请稍后再试'),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? '登记中…' : '补货通知我'}
        </Button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
