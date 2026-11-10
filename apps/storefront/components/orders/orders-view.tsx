'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageSearch, Search } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, formatMoney } from '@mall/ui';
import { TextField } from '@/components/form-field';
import { ORDER_STATUS_META, findOrder, findOrderByIdentity, formatDateTime, listOrders, orderRecordToView, type OrderView } from '@/lib/orders';
import { getApiMode } from '@/lib/api';
import { loadLiveOrder } from '@/lib/checkout';
import { OrderDetail } from './order-detail';

export function OrdersView({ orderId, locale, channel }: { orderId?: string; locale: string; channel: string }) {
  const router = useRouter();
  const base = `/${locale}/${channel}`;
  const live = getApiMode() === 'live';
  const [mounted, setMounted] = useState(false);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [detail, setDetail] = useState<OrderView | null>(null);
  const [queryId, setQueryId] = useState('');
  const [identity, setIdentity] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setOrders(listOrders());
    if (!orderId) {
      setDetail(null);
      return;
    }
    if (!live) {
      setDetail(findOrder(orderId));
      return;
    }
    // live 模式：订单在后端，按单号查（游客单号 + 后端订单号都能查到）。
    void loadLiveOrder(orderId).then((record) => {
      setDetail(record ? orderRecordToView(record) : null);
    });
  }, [orderId, live]);

  const onQuery = () => {
    const res = findOrderByIdentity(queryId.trim(), identity.trim());
    if (res.order) {
      setError(null);
      router.push(`${base}/orders?order=${res.order.id}`);
    } else {
      setError(res.error ?? '查询失败，请稍后重试');
    }
  };

  // 详情模式
  if (orderId) {
    return (
      <div className="mx-auto max-w-content px-4 py-6">
        <a
          href={`${base}/orders`}
          className="mb-4 inline-block text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          ← 返回订单列表
        </a>
        {!mounted ? (
          <Skeleton className="h-48 w-full" />
        ) : detail ? (
          <OrderDetail order={detail} />
        ) : (
          <div className="py-16 text-center">
            <p className="text-lg font-medium text-foreground">未找到该订单</p>
            <p className="mt-1 text-sm text-muted-foreground">订单号可能有误，或订单已过期</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-content px-4 py-6 md:py-8">
      <h1 className="mb-4 text-xl md:text-2xl">订单查询</h1>

      {/* 游客查单入口 */}
      <section className="mb-8 rounded-lg border border-border bg-card p-4" aria-labelledby="query-heading">
        <h2 id="query-heading" className="mb-3 text-base font-semibold">
          按订单号查询
        </h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <TextField
            id="query-order"
            label="订单号"
            placeholder="如 ord_sample_7f3k"
            value={queryId}
            onChange={(e) => setQueryId(e.target.value)}
          />
          <TextField
            id="query-identity"
            label="手机后四位 / 邮箱"
            placeholder="用于验证订单归属"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
          />
          <Button onClick={onQuery} className="sm:mb-0.5">
            <Search className="size-4" strokeWidth={2} aria-hidden="true" />
            查询
          </Button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">示例可查：ord_sample_7f3k / 1234</p>
      </section>

      {/* 订单列表 */}
      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="mb-3 text-base font-semibold">
          我的订单
        </h2>
        {!mounted ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="还没有订单"
            description="下单后可以在这里查物流"
            action={<Button onClick={() => router.push(`${base}/products`)}>去逛逛</Button>}
          />
        ) : (
          <ul className="space-y-3">
            {orders.map((o) => (
              <OrderRow key={o.id} order={o} base={base} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OrderRow({ order, base }: { order: OrderView; base: string }) {
  const meta = ORDER_STATUS_META[order.status];
  const totalQty = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <li>
      <a
        href={`${base}/orders?order=${order.id}`}
        className="block rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:border-border-strong"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="tabular font-mono text-xs text-muted-foreground">{order.id}</span>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex shrink-0 gap-1">
            {order.items.slice(0, 3).map((item, i) =>
              item.imageUrl ? (
                <img key={i} src={item.imageUrl} alt={item.title} loading="lazy" className="aspect-square w-12 rounded-sm object-cover" />
              ) : (
                <div key={i} className="aspect-square w-12 rounded-sm bg-secondary" aria-hidden="true" />
              ),
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-foreground">
              {order.items.map((i) => i.title).join('、')} 共 {totalQty} 件
            </p>
            <p className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</p>
          </div>
          <span className="tabular shrink-0 text-sm font-semibold">{formatMoney(order.totalMinor, order.currencyCode)}</span>
        </div>
      </a>
    </li>
  );
}
