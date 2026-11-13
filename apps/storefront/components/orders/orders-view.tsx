'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageSearch, Search } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, formatMoney } from '@mall/ui';
import { TextField } from '@/components/form-field';
import {
  ORDER_STATUS_META,
  findOrder,
  findOrderByIdentity,
  formatDateTime,
  listOrders,
  orderRecordToView,
  type OrderStatusKey,
  type OrderView,
} from '@/lib/orders';
import type { Order } from '@mall/sdk';
import { getApiMode, getStoreClient, syncStoreToken } from '@/lib/api';
import { loadLiveOrder, toOrderRecord } from '@/lib/checkout';
import { restoreSession, type CustomerProfile } from '@/lib/account';
import { OrderDetail } from './order-detail';

type OrderFilter = 'all' | 'unpaid' | 'to_ship' | 'to_receive' | 'completed';

/**
 * 状态页签（对齐淘宝「已买到的宝贝」）。
 *
 * `statuses` 给服务端（逗号分隔多状态），`view` 给 mock 模式本地过滤 ——
 * 两边口径必须一致，否则同一页在两种模式下会给出不同的分组。
 */
const ORDER_FILTERS: Array<{
  key: OrderFilter;
  label: string;
  statuses?: string;
  view?: OrderStatusKey[];
}> = [
  { key: 'all', label: '全部' },
  { key: 'unpaid', label: '待付款', statuses: 'pending,awaiting_payment', view: ['awaiting_payment'] },
  { key: 'to_ship', label: '待发货', statuses: 'paid,partially_fulfilled', view: ['to_ship'] },
  { key: 'to_receive', label: '待收货', statuses: 'fulfilled,delivered', view: ['to_receive'] },
  { key: 'completed', label: '已完成', statuses: 'completed', view: ['completed'] },
];

export function OrdersView({
  orderId,
  locale,
  channel,
  returnAddress = null,
  autoOpenRefund = false,
}: {
  orderId?: string;
  locale: string;
  channel: string;
  /** 店铺退货地址（ADR-053）：退货退款时顾客照着寄回。 */
  returnAddress?: string | null;
  /** 从订单列表点「申请售后」进来时，自动展开退款表单（ADR-065）。 */
  autoOpenRefund?: boolean;
}) {
  const router = useRouter();
  const base = `/${locale}/${channel}`;
  const live = getApiMode() === 'live';
  const [mounted, setMounted] = useState(false);
  const [orders, setOrders] = useState<OrderView[]>([]);
  /** 已登录顾客（live）：决定显示「我的订单」还是游客查单。 */
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [filter, setFilter] = useState<OrderFilter>('all');
  /** 分页：一页 20 单，超过就翻页（顾客订单多时第 21 单不能凭空消失）。 */
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [detail, setDetail] = useState<OrderView | null>(null);
  /** 订单详情被改动（如确认收货）后自增，触发重新拉取。 */
  const [detailVersion, setDetailVersion] = useState(0);
  const [queryId, setQueryId] = useState('');
  const [identity, setIdentity] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 订单列表：mock 读本地；live 先恢复登录态，再拉「我的订单」
  useEffect(() => {
    setMounted(true);
    if (!live) {
      const all = listOrders();
      const view = ORDER_FILTERS.find((f) => f.key === filter)?.view;
      const filteredAll = view ? all.filter((o) => view.includes(o.status)) : all;
      const start = (page - 1) * PAGE_SIZE;
      setOrders(filteredAll.slice(start, start + PAGE_SIZE));
      setHasMore(start + PAGE_SIZE < filteredAll.length);
      return;
    }
    let cancelled = false;
    setLoadingOrders(true);
    void (async () => {
      // 登录态以服务端为准：本地缓存可能已过期（token 会在这里自动 refresh）
      const next = await restoreSession();
      if (cancelled) return;
      setProfile(next);
      if (!next) {
        setOrders([]);
        setLoadingOrders(false);
        return;
      }
      syncStoreToken();
      try {
        const statuses = ORDER_FILTERS.find((f) => f.key === filter)?.statuses;
        const res = (await getStoreClient().listMyOrders({
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          ...(statuses ? { status: statuses } : {}),
        })) as { items?: Order[]; hasMore?: boolean };
        if (!cancelled) {
          setOrders((res.items ?? []).map((o) => orderRecordToView(toOrderRecord(o))));
          setHasMore(res.hasMore === true);
        }
      } catch {
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoadingOrders(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, filter, page]);

  // 详情：按单号查（游客单号 + 后端订单号都能查到）
  useEffect(() => {
    if (!orderId) {
      setDetail(null);
      return;
    }
    if (!live) {
      setDetail(findOrder(orderId));
      return;
    }
    let cancelled = false;
    void loadLiveOrder(orderId).then((record) => {
      if (!cancelled) setDetail(record ? orderRecordToView(record) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, live, detailVersion]);

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
          <OrderDetail
            order={detail}
            returnAddress={returnAddress}
            autoOpenRefund={autoOpenRefund}
            onUpdated={() => setDetailVersion((v) => v + 1)}
          />
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
        <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="订单状态">
          {ORDER_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => {
                // 换页签回第一页：停在第 3 页筛一个只有 5 单的状态会看到空列表
                setFilter(f.key);
                setPage(1);
              }}
              className={
                filter === f.key
                  ? 'h-8 rounded-md bg-primary-subtle px-3 text-sm font-medium text-primary-subtle-foreground'
                  : 'h-8 rounded-md px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted'
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {!mounted || loadingOrders ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : live && !profile ? (
          /*
           * 未登录不显示空列表：空态会让顾客以为订单丢了。
           * 明确告诉他登录后能看到全部订单，游客仍可用上面的单号查询。
           */
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-foreground">登录后查看全部订单</p>
            <p className="mt-1 text-xs text-muted-foreground">
              包括物流进度、退款状态，换设备也能看到
            </p>
            <Button className="mt-3" onClick={() => router.push(`${base}/account`)}>
              去登录
            </Button>
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={filter === 'all' ? '还没有订单' : '这个状态下没有订单'}
            description={filter === 'all' ? '下单后可以在这里查物流' : '换个页签看看'}
            action={<Button onClick={() => router.push(`${base}/products`)}>去逛逛</Button>}
          />
        ) : (
          <>
            <ul className="space-y-3">
              {orders.map((o) => (
                <OrderRow key={o.id} order={o} base={base} />
              ))}
            </ul>
            {(page > 1 || hasMore) && (
              <nav aria-label="订单分页" className="mt-4 flex items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <span className="tabular text-sm text-muted-foreground">第 {page} 页</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function OrderRow({ order, base }: { order: OrderView; base: string }) {
  const meta = ORDER_STATUS_META[order.status];
  const totalQty = order.items.reduce((n, i) => n + i.quantity, 0);
  const canRefund = order.status === 'to_ship' || order.status === 'to_receive' || order.status === 'completed';
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <a
        href={`${base}/orders?order=${order.id}`}
        className="block transition-colors duration-150 hover:border-border-strong"
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
      {/*
        申请售后（ADR-065）：淘宝订单列表每单都有「退款/售后」入口。
        之前退款藏在详情页最下面，顾客想退还要先翻完物流和金额 —— 找不到就是没有。
        只在可退状态出现，避免「已取消/已退款」的订单还挂着售后入口。
      */}
      {canRefund && (
        <div className="mt-3 flex justify-end border-t border-border pt-3">
          <a
            href={`${base}/orders?order=${order.id}&refund=1`}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors duration-150 hover:bg-muted"
          >
            申请售后
          </a>
        </div>
      )}
    </li>
  );
}
