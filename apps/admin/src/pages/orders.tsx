import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, ChevronRight, Search } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  formatMoney,
  cn,
} from '@mall/ui';
import { OrderDetail } from '@/components/order-detail';
import { listOrders, type OrderListResult } from '@/lib/admin-api';
import { FUL_META, PAY_META } from '@/lib/admin-meta';
import type { AdminOrder } from '@/lib/admin-data';

type Filter = 'all' | 'unfulfilled' | 'partial' | 'shipped' | 'refunding' | 'refunded';

/**
 * 状态页签（对齐淘宝订单列表）。
 *
 * 每个页签对应一组 order.status —— 后端按状态筛，不在前端过滤：
 * 之前是拉 100 条再本地筛，订单一多就静默漏，工作台说「待发货 5」点进来还可能是空列表。
 *
 * 「待发货」只含 paid：refund_pending 是另一个状态，混进来会出现「货发了、钱也退了」。
 */
const FILTERS: { value: Filter; label: string; statuses?: string[] }[] = [
  { value: 'all', label: '全部' },
  { value: 'unfulfilled', label: '待发货', statuses: ['paid'] },
  { value: 'partial', label: '部分发货', statuses: ['partially_fulfilled'] },
  { value: 'shipped', label: '已发货', statuses: ['fulfilled', 'delivered'] },
  { value: 'refunding', label: '退款中', statuses: ['refund_pending'] },
  { value: 'refunded', label: '已退款', statuses: ['refunded'] },
];

const PAGE_SIZE = 20;

export function OrdersPage() {
  const [searchParams] = useSearchParams();
  const initialFilter = (searchParams.get('filter') as Filter | null) ?? 'all';
  const [result, setResult] = useState<OrderListResult>({
    items: [],
    total: 0,
    counts: {},
    hasMore: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(
    FILTERS.some((f) => f.value === initialFilter) ? initialFilter : 'all',
  );
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 搜索防抖 300ms：每敲一个字都打一次接口既浪费也会让结果闪
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  // 换页签 / 换关键字都回到第一页，否则会停在一个不存在的页码上
  useEffect(() => {
    setPage(0);
  }, [filter, debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statuses = FILTERS.find((f) => f.value === filter)?.statuses;
      const res = await listOrders({
        ...(statuses ? { statuses } : {}),
        ...(debounced ? { q: debounced } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setResult(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取订单失败');
    } finally {
      setLoading(false);
    }
  }, [filter, debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    void load();
  };

  /** 页签角标：该页签包含的状态数之和。 */
  const countFor = (f: (typeof FILTERS)[number]) =>
    f.statuses
      ? f.statuses.reduce((sum, st) => sum + (result.counts[st] ?? 0), 0)
      : Object.values(result.counts).reduce((a, b) => a + b, 0);

  const orders = result.items;
  const selected = orders.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">订单</h1>
        <label className="relative block w-full max-w-xs">
          <span className="sr-only">搜索订单</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索订单号或客户"
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-ring"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="订单筛选">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'h-8 rounded-md px-3 text-sm transition-colors duration-150',
              filter === f.value ? 'bg-primary-subtle font-medium text-primary-subtle-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {f.label}
            {countFor(f) > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">{countFor(f)}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="没有订单"
          description={debounced ? '换个关键字试试，或清空搜索' : '订单产生后会自动出现在这里'}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">订单</th>
                <th scope="col" className="px-4 py-3 font-medium">商品</th>
                <th scope="col" className="px-4 py-3 font-medium">金额</th>
                <th scope="col" className="px-4 py-3 font-medium">支付</th>
                <th scope="col" className="px-4 py-3 font-medium">履约</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => {
                const pay = PAY_META[o.paymentStatus];
                const ful = FUL_META[o.fulfillmentStatus];
                const qty = o.items.reduce((n, i) => n + i.quantity, 0);
                return (
                  <tr key={o.id} className="transition-colors duration-150 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span className="block font-mono text-xs text-foreground">{o.id}</span>
                      <span className="block text-xs text-muted-foreground">
                        {o.customerName} · {o.createdAt}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{qty} 件</td>
                    <td className="tabular px-4 py-3 font-medium">{formatMoney(o.totalMinor, o.currency)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={pay.variant}>{pay.label}</Badge>
                        {/* 退款中必须在列表就能看见：否则商家以为还能发货 */}
                        {o.orderStatus === 'refund_pending' && (
                          <Badge variant="warning">退款中</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ful.variant}>{ful.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <IconButton aria-label={`查看订单 ${o.id}`} size="sm" onClick={() => setSelectedId(o.id)}>
                          <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Sheet
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedId(null);
        }}
      >
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{selected ? `订单 ${selected.id}` : ''}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {selected && (
              <OrderDetail
                order={selected}
                onUpdated={() => {
                  refresh();
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          共 {result.total} 笔 · 待发货 {result.counts.paid ?? 0} 笔 · 退款中{' '}
          {result.counts.refund_pending ?? 0} 笔
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">第 {page + 1} 页</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!result.hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}
