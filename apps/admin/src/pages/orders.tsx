import { useEffect, useState } from 'react';
import { ClipboardList, ChevronRight, Search } from 'lucide-react';
import {
  Badge,
  EmptyState,
  IconButton,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  formatMoney,
  cn,
} from '@mall/ui';
import { OrderDetail } from '@/components/order-detail';
import { listOrders } from '@/lib/admin-api';
import { FUL_META, PAY_META } from '@/lib/admin-meta';
import type { AdminOrder } from '@/lib/admin-data';

type Filter = 'all' | 'unfulfilled' | 'partial' | 'shipped' | 'refunding' | 'refunded';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'unfulfilled', label: '待发货' },
  { value: 'partial', label: '部分发货' },
  { value: 'shipped', label: '已发货' },
  // 淘宝的「退款中」独立一栏：待审核的退款要能被单独筛出来，不能混在全部里
  { value: 'refunding', label: '退款中' },
  { value: 'refunded', label: '已退款' },
];

export function OrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void listOrders().then(setOrders);
  }, []);

  const refresh = () => {
    void listOrders().then(setOrders);
  };

  const filtered = orders.filter((o) => {
    // 待发货里不能混入退款中的单：商家照着这个列表发货，混进去就会「货发了、钱也退了」
    if (filter === 'unfulfilled' && (o.fulfillmentStatus !== 'unfulfilled' || o.orderStatus === 'refund_pending'))
      return false;
    if (filter === 'partial' && o.fulfillmentStatus !== 'partial') return false;
    if (filter === 'shipped' && o.fulfillmentStatus !== 'shipped') return false;
    if (filter === 'refunding' && o.orderStatus !== 'refund_pending') return false;
    if (filter === 'refunded' && o.orderStatus !== 'refunded' && o.paymentStatus !== 'refunded')
      return false;
    const q = query.trim().toLowerCase();
    return !q || o.id.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q);
  });

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
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ClipboardList} title="没有订单" description="订单产生后会自动出现在这里" />
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
              {filtered.map((o) => {
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

      <p className="text-xs text-muted-foreground">
        共 {filtered.length} 笔 · 待发货 {orders.filter((o) => o.fulfillmentStatus === 'unfulfilled').length} 笔 ·
        部分发货 {orders.filter((o) => o.fulfillmentStatus === 'partial').length} 笔
      </p>
    </div>
  );
}
