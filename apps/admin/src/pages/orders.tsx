import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, ChevronRight, Download, Search, Truck } from 'lucide-react';
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
import { BatchShipDialog } from '@/components/batch-ship-dialog';
import { downloadBlob, exportOrdersCsv, listOrders, type OrderListResult } from '@/lib/admin-api';
import { FUL_META, PAY_META } from '@/lib/admin-meta';
import type { AdminOrder } from '@/lib/admin-data';

type Filter = 'all' | 'unfulfilled' | 'partial' | 'shipped' | 'refunding' | 'refunded';

/** 售后进度角标文案（ADR-073）：与「退款管理」页签同名，商家不用二次翻译。 */
const REFUND_STAGE_LABEL: Record<'review' | 'awaiting_return' | 'returned', string> = {
  review: '待审退款',
  awaiting_return: '等买家寄回',
  returned: '退货待收货',
};

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

/** 时间筛选（淘宝「已卖出的宝贝」上方的时间条）。 */
type RangeKey = 'all' | 'today' | '7d' | '30d' | 'custom';
const RANGES: { value: RangeKey; label: string }[] = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'custom', label: '自定义' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * 快捷时间段 → 起止日期（含当天）。
 *
 * 按**本地日**算：商家在深圳，用 UTC 切日会凭空少掉 8 小时的单。
 * 服务端同样按本地日解释（ADR-056）。
 */
function rangeToDates(key: RangeKey, customFrom: string, customTo: string): { from?: string; to?: string } {
  const today = new Date();
  if (key === 'today') return { from: toDay(today), to: toDay(today) };
  if (key === '7d' || key === '30d') {
    const start = new Date(today);
    start.setDate(start.getDate() - (key === '7d' ? 6 : 29));
    return { from: toDay(start), to: toDay(today) };
  }
  if (key === 'custom') {
    return {
      ...(customFrom ? { from: customFrom } : {}),
      ...(customTo ? { to: customTo } : {}),
    };
  }
  return {};
}

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
  const [flash, setFlash] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(
    FILTERS.some((f) => f.value === initialFilter) ? initialFilter : 'all',
  );
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  /** 下单时间筛选：快捷段 + 自定义起止日。 */
  const [range, setRange] = useState<RangeKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(0);
  /** 批量发货选中的订单 id（只含可发货的单）。 */
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  /** 导出中：按钮置灰，避免连点导出几份不同时刻的数据 */
  const [exporting, setExporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 搜索防抖 300ms：每敲一个字都打一次接口既浪费也会让结果闪
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  // 换页签 / 换关键字都回到第一页，否则会停在一个不存在的页码上
  useEffect(() => {
    setPage(0);
  }, [filter, debounced, range, customFrom, customTo]);

  // 换页签 / 换页 / 换关键字就清空勾选：留着会导致「对看不见的订单发货」
  useEffect(() => {
    setPickedIds(new Set());
  }, [filter, debounced, page, range, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statuses = FILTERS.find((f) => f.value === filter)?.statuses;
      const res = await listOrders({
        ...(statuses ? { statuses } : {}),
        ...(debounced ? { q: debounced } : {}),
        ...rangeToDates(range, customFrom, customTo),
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
  }, [filter, debounced, page, range, customFrom, customTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    void load();
  };

  /** 页签角标：该页签包含的状态数之和。 */
  /**
   * 导出当前筛选结果（ADR-057）。
   *
   * 导出用**和列表同一套条件**：商家看到什么就导出什么。
   * 时间戳写进文件名，两份导出的表格放一起能分清先后。
   */
  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const statuses = FILTERS.find((f) => f.value === filter)?.statuses;
      const blob = await exportOrdersCsv({
        ...(statuses ? { statuses } : {}),
        ...(debounced ? { q: debounced } : {}),
        ...rangeToDates(range, customFrom, customTo),
      });
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .slice(0, 13)
        .replace('T', '-');
      downloadBlob(blob, `orders-${stamp}.csv`);
      setFlash(`已导出 ${result.total} 单`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const countFor = (f: (typeof FILTERS)[number]) =>
    f.statuses
      ? f.statuses.reduce((sum, st) => sum + (result.counts[st] ?? 0), 0)
      : Object.values(result.counts).reduce((a, b) => a + b, 0);

  const orders = result.items;
  const selected = orders.find((o) => o.id === selectedId) ?? null;

  /** 只有「待发货」的订单能被批量选中：退款中的单发了就是净亏。 */
  const pickable = orders.filter((o) => o.orderStatus === 'paid');
  const pickedOrders = orders.filter((o) => pickedIds.has(o.id));
  const allPicked = pickable.length > 0 && pickable.every((o) => pickedIds.has(o.id));

  const togglePick = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePickAll = () => {
    setPickedIds(allPicked ? new Set() : new Set(pickable.map((o) => o.id)));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">订单</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={exporting || loading}
            onClick={() => void exportCsv()}
          >
            <Download className="mr-1 size-3.5" strokeWidth={2} aria-hidden="true" />
            {exporting ? '导出中…' : '导出 CSV'}
          </Button>
        </div>
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

      {/* 批量操作条：只在勾了单之后出现，不占常驻空间 */}
      {flash && (
        <p className="text-xs text-success" role="status">
          {flash}
        </p>
      )}

      {pickedOrders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2">
          <span className="text-sm text-foreground">已选 {pickedOrders.length} 单</span>
          <Button size="sm" onClick={() => setBatchOpen(true)}>
            <Truck className="mr-1 size-3.5" strokeWidth={2} aria-hidden="true" />
            批量发货
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPickedIds(new Set())}>
            取消选择
          </Button>
          <span className="text-xs text-muted-foreground">
            只有待发货订单可批量发；退款中的单不在此列
          </span>
        </div>
      )}

      {/* 时间条：按日期对账/批量发货时用，与状态页签正交 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="下单时间筛选">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={range === r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs transition-colors duration-150',
                range === r.value
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <label htmlFor="orders-from" className="sr-only">起始日期</label>
            <input
              id="orders-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
            />
            <span>至</span>
            <label htmlFor="orders-to" className="sr-only">结束日期</label>
            <input
              id="orders-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
            />
          </div>
        )}
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
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="全选待发货订单"
                    checked={allPicked}
                    disabled={pickable.length === 0}
                    onChange={togglePickAll}
                    className="size-4 align-middle"
                  />
                </th>
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
                      {o.orderStatus === 'paid' ? (
                        <input
                          type="checkbox"
                          aria-label={`选中订单 ${o.id}`}
                          checked={pickedIds.has(o.id)}
                          onChange={() => togglePick(o.id)}
                          className="size-4 align-middle"
                        />
                      ) : (
                        // 非待发货不可选：留空位保持列对齐，不显示禁用框（省一列噪音）
                        <span aria-hidden="true" className="block size-4" />
                      )}
                    </td>
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
                        {/*
                          售后进度（ADR-073）：三档动作完全不同 —— 待审要回、等寄回不用管、
                          已寄回要去收货退款。只写「退款中」等于让商家逐单点开看。
                        */}
                        {o.refundStage ? (
                          <Badge variant="warning">{REFUND_STAGE_LABEL[o.refundStage]}</Badge>
                        ) : o.orderStatus === 'refund_pending' ? (
                          <Badge variant="warning">退款中</Badge>
                        ) : null}
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

      <BatchShipDialog
        open={batchOpen}
        orders={pickedOrders}
        onOpenChange={setBatchOpen}
        onDone={() => {
          // 发完清空勾选并刷新列表：状态徽标要立刻变成「已发货」
          setPickedIds(new Set());
          refresh();
        }}
      />

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
          筛选结果 {result.total} 笔
          {/* 角标是全店口径、不随时间筛选变：不写清楚会让商家以为待发货变少了 */}
          <span className="ml-2 text-muted-foreground/80">
            全店：待发货 {result.counts.paid ?? 0} 笔 · 退款中 {result.counts.refund_pending ?? 0} 笔
          </span>
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
