'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck, CircleX, Copy, Loader2 } from 'lucide-react';
import { Button, IconButton, formatMoney } from '@mall/ui';
import { demoOrder, failOrder, getOrder, loadLiveOrder, peekOrder, type OrderRecord } from '@/lib/checkout';
import { getApiMode } from '@/lib/api';
import { useCart } from '@/lib/cart-store';

interface PaymentResultProps {
  orderId: string;
  simulate?: 'failed' | 'processing';
  locale: string;
  channel: string;
}

/** 支付结果三态（成功/处理中/失败），可重入：按 order id 幂等查询，刷新不丢。 */
export function PaymentResult({ orderId, simulate, locale, channel }: PaymentResultProps) {
  const router = useRouter();
  const live = getApiMode() === 'live';
  const { items: cartItems, removeItem, clearCart } = useCart();
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'notfound'>('loading');
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    if (!orderId) {
      setPhase('notfound');
      return;
    }
    if (live) {
      // live：以后端订单为准（支付商回调是异步的，状态靠轮询推进）。
      void (async () => {
        const found = await loadLiveOrder(orderId);
        if (found) {
          setOrder(found);
          setPhase('ready');
        } else {
          setPhase('notfound');
        }
      })();
      return;
    }
    if (simulate === 'failed') {
      failOrder(orderId, '银行卡余额不足或支付超时，请重新支付');
      const base = peekOrder(orderId) ?? demoOrder(orderId);
      setOrder({ ...base, status: 'failed', failureReason: '银行卡余额不足或支付超时，请重新支付' });
      setPhase('ready');
      return;
    }
    if (simulate === 'processing') {
      const base = peekOrder(orderId) ?? demoOrder(orderId);
      setOrder({ ...base, status: 'processing' });
      setPhase('ready');
      return;
    }
    const found = getOrder(orderId);
    if (found) {
      setOrder(found);
      setPhase('ready');
    } else {
      setPhase('notfound');
    }
  }, [orderId, simulate, live]);

  useEffect(() => {
    load();
  }, [load]);

  const status = simulate === 'failed' ? 'failed' : simulate === 'processing' ? 'processing' : order?.status;

  // 处理中轮询（每 3 秒；simulate 锁定时不轮询）
  useEffect(() => {
    if (status !== 'processing' || simulate) return;
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [status, simulate, load]);

  // 支付成功后清空购物车（幂等；空车时无副作用）
  //
  // live 模式必须整车丢弃（clearCart），而不是逐行删：后端下单后购物车已被软删除，
  // 留着旧 cartId 会让下一单复用同一个幂等键前缀、拿回上一笔订单。
  useEffect(() => {
    if (status !== 'paid') return;
    if (live) {
      clearCart();
      return;
    }
    for (const item of cartItems) removeItem(item.id);
  }, [status, live, cartItems, removeItem, clearCart]);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(orderId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用 */
    }
  };

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-narrow px-4 py-16 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" strokeWidth={2} aria-hidden="true" />
        <p className="mt-3 text-sm text-muted-foreground">正在查询订单状态…</p>
      </div>
    );
  }

  if (phase === 'notfound' || !order) {
    return (
      <div className="mx-auto max-w-narrow px-4 py-16 text-center">
        <CircleX className="mx-auto size-12 text-destructive" strokeWidth={1.75} aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold">找不到这笔订单</h1>
        <p className="mt-2 text-sm text-muted-foreground">订单可能已过期或链接有误，请返回首页重新查看</p>
        <Button className="mt-6" onClick={() => router.push(`/${locale}/${channel}`)}>
          返回首页
        </Button>
      </div>
    );
  }

  const amount = formatMoney(order.totalMinor, order.currencyCode);

  const copyBlock = (
    <div className="mt-3 flex items-center justify-center gap-1 text-sm text-muted-foreground">
      <span>订单号</span>
      <span className="tabular font-mono text-foreground">{order.id}</span>
      <IconButton aria-label="复制订单号" size="sm" onClick={copyId}>
        <Copy className="size-4" strokeWidth={2} aria-hidden="true" />
      </IconButton>
      <span className="sr-only" aria-live="polite">
        {copied ? '已复制订单号' : ''}
      </span>
    </div>
  );

  return (
    <div className="mx-auto max-w-narrow px-4 py-12" aria-live="polite">
      {status === 'paid' && (
        <>
          <CircleCheck className="mx-auto size-12 text-success" strokeWidth={1.75} aria-hidden="true" />
          <h1 className="mt-4 text-center text-2xl font-semibold">订单已支付</h1>
          {copyBlock}
          <p className="tabular mt-4 text-center text-display text-foreground">{amount}</p>
          <p className="mt-2 text-center text-sm text-muted-foreground">预计 1–2 个工作日内发货，发货后可在订单中查看物流</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              onClick={() => router.push(`/${locale}/${channel}/orders?order=${order.id}`)}
            >
              查看订单
            </Button>
            <Button size="lg" variant="secondary" onClick={() => router.push(`/${locale}/${channel}/products`)}>
              继续购物
            </Button>
          </div>
        </>
      )}

      {status === 'processing' && (
        <>
          <Loader2 className="mx-auto size-12 animate-spin text-info" strokeWidth={1.75} aria-hidden="true" />
          <h1 className="mt-4 text-center text-2xl font-semibold">正在确认支付结果</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">每 3 秒自动刷新，也可以手动刷新</p>
          {copyBlock}
          <div className="mt-8 flex justify-center">
            <Button size="lg" variant="secondary" onClick={load}>
              手动刷新
            </Button>
          </div>
        </>
      )}

      {status === 'failed' && (
        <>
          <CircleX className="mx-auto size-12 text-destructive" strokeWidth={1.75} aria-hidden="true" />
          <h1 className="mt-4 text-center text-2xl font-semibold">支付未完成</h1>
          <p className="mt-1 text-center text-sm text-destructive">{order.failureReason ?? '支付过程中出现问题，请重新支付'}</p>
          {copyBlock}
          <p className="tabular mt-4 text-center text-display text-foreground">{amount}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" onClick={() => router.push(`/${locale}/${channel}/checkout`)}>
              重新支付
            </Button>
            <a
              href="mailto:support@example.com"
              className="inline-flex h-13 items-center justify-center rounded-md bg-secondary px-6 text-base font-medium text-secondary-foreground transition-colors duration-150 hover:bg-muted"
            >
              联系客服
            </a>
          </div>
        </>
      )}

      <div className="mt-10 rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold">订单摘要</h2>
        <ul className="space-y-2 text-sm">
          {order.items.map((item, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {item.title}
                {item.variantTitle ? ` · ${item.variantTitle}` : ''} × {item.quantity}
              </span>
              <span className="tabular shrink-0">{formatMoney(item.unitPriceMinor * item.quantity, order.currencyCode)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-base font-semibold">
          <span>合计</span>
          <span className="tabular">{amount}</span>
        </div>
      </div>
    </div>
  );
}
