'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { CircleX, Loader2 } from 'lucide-react';
import { Button, formatMoney } from '@mall/ui';
import { describeError, loadLiveOrder, readPendingPayment, type PendingPayment } from '@/lib/checkout';

interface PaymentPayProps {
  orderId: string;
  locale: string;
  channel: string;
}

/**
 * 二维码支付页（live 模式）。
 *
 * 支付宝当面付是「用户扫码 → 支付商异步回调后端 → 订单变 paid」的链路，
 * 前端拿不到同步的支付结果，所以这里轮询订单状态，收到 captured 才跳结果页。
 */
export function PaymentPay({ orderId, locale, channel }: PaymentPayProps) {
  const router = useRouter();
  // 待支付会话存在 sessionStorage（服务端渲染时读不到），挂载后再读。
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setPending(readPendingPayment(orderId));
  }, [orderId]);

  const check = useCallback(async () => {
    if (!orderId) return;
    setChecking(true);
    try {
      const order = await loadLiveOrder(orderId);
      if (!order) {
        setError('订单不存在或已失效');
        return;
      }
      if (order.status === 'paid') {
        router.replace(`/${locale}/${channel}/checkout/result?order=${orderId}`);
        return;
      }
      if (order.status === 'failed') {
        setError(order.failureReason ?? '支付未完成，请重新支付');
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setChecking(false);
    }
  }, [orderId, router, locale, channel]);

  // 轮询订单状态：支付商回调是异步的，只有订单变 paid 才能确认收款。
  useEffect(() => {
    if (!orderId) return;
    const timer = window.setInterval(() => void check(), 3000);
    return () => window.clearInterval(timer);
  }, [orderId, check]);

  if (!orderId) {
    return (
      <div className="mx-auto max-w-narrow px-4 py-16 text-center">
        <CircleX className="mx-auto size-12 text-destructive" strokeWidth={1.75} aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold">缺少订单号</h1>
        <Button className="mt-6" onClick={() => router.push(`/${locale}/${channel}/checkout`)}>
          返回结算
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-narrow px-4 py-16 text-center">
        <CircleX className="mx-auto size-12 text-destructive" strokeWidth={1.75} aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold">支付未完成</h1>
        <p className="mt-2 text-sm text-destructive">{error}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button size="lg" onClick={() => router.push(`/${locale}/${channel}/checkout`)}>
            重新支付
          </Button>
          <Button size="lg" variant="secondary" onClick={() => router.push(`/${locale}/${channel}/checkout/result?order=${orderId}`)}>
            查看订单
          </Button>
        </div>
      </div>
    );
  }

  if (!pending) {
    return (
      <div className="mx-auto max-w-narrow px-4 py-16 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" strokeWidth={2} aria-hidden="true" />
        <p className="mt-3 text-sm text-muted-foreground">正在准备支付二维码…</p>
        <Button className="mt-6" variant="secondary" onClick={() => router.push(`/${locale}/${channel}/checkout/result?order=${orderId}`)}>
          查看订单状态
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-narrow px-4 py-10 text-center">
      <h1 className="text-xl font-semibold">请扫码支付</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        使用「{pending.providerLabel}」扫描下方二维码完成付款，支付成功后本页会自动跳转。
      </p>

      <div className="mx-auto mt-6 inline-flex rounded-lg border border-border bg-card p-4">
        {pending.qrPayload ? (
          <QRCodeSVG value={pending.qrPayload} size={220} level="M" marginSize={0} />
        ) : (
          <div className="grid size-[220px] place-items-center text-sm text-muted-foreground">
            二维码不可用
          </div>
        )}
      </div>

      <p className="tabular mt-6 text-display text-foreground">
        {formatMoney(pending.amountMinor, pending.currencyCode)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        订单号 <span className="tabular font-mono">{pending.orderId}</span>
      </p>

      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          正在等待支付结果…
        </p>
        <Button variant="secondary" onClick={() => void check()} loading={checking}>
          我已支付，刷新状态
        </Button>
      </div>
    </div>
  );
}
