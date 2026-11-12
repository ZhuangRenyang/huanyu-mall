import { useCallback, useEffect, useState } from 'react';
import { Banknote, Check, X } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  formatMoney,
  cn,
} from '@mall/ui';
import { TextAreaField } from '../components/field';
import {
  approveRefundRequest,
  listRefundRequests,
  rejectRefundRequest,
  type RefundRequestView,
  type RefundStatus,
} from '@/lib/admin-refunds';
import { getAdminApiMode } from '@/lib/admin-client';

/**
 * 退款管理（对齐淘宝「交易 → 退款管理」）。
 *
 * 商家在这里处理**顾客发起的退款申请**：同意的会真正打款（走 workflow），
 * 拒绝的必须写理由 —— 顾客在店面能看到处理结果。
 *
 * 单独成页而不是塞进订单详情：退款是独立单据，有自己的状态与时效；
 * 混在订单里就没法「按待处理筛出全部要处理的」。
 */
const PAGE_SIZE = 20;

const STATUS_TABS: { value: RefundStatus | 'all'; label: string }[] = [
  { value: 'pending', label: '待处理' },
  { value: 'approved', label: '已同意' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部' },
];

const STATUS_META: Record<RefundStatus, { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  pending: { label: '待处理', tone: 'warning' },
  approved: { label: '已同意', tone: 'success' },
  rejected: { label: '已拒绝', tone: 'neutral' },
  canceled: { label: '已撤销', tone: 'neutral' },
};

export function RefundsPage() {
  const [items, setItems] = useState<RefundRequestView[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<RefundStatus | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<RefundRequestView | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const demo = getAdminApiMode() !== 'live';

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listRefundRequests({
        status: status === 'all' ? undefined : status,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const approve = async (item: RefundRequestView) => {
    if (
      !window.confirm(
        `确认同意退款？将立即向顾客退回 ${formatMoney(item.amountMinor, item.currencyCode)}，无法撤销。`,
      )
    ) {
      return;
    }
    setBusyId(item.id);
    setError(null);
    try {
      await approveRefundRequest(item.id);
      setFlash('已同意并完成退款');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '退款失败');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    if (rejectNote.trim() === '') {
      setError('拒绝退款必须填写理由');
      return;
    }
    setBusyId(rejecting.id);
    setError(null);
    try {
      await rejectRefundRequest(rejecting.id, rejectNote.trim());
      setRejecting(null);
      setRejectNote('');
      setFlash('已拒绝该退款申请');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">退款管理</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          顾客申请的退款在这里处理。同意后立即原路退回，拒绝需填写理由（顾客可见）。
        </p>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="退款状态筛选">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => setStatus(tab.value)}
            className={cn(
              'h-8 rounded-md px-3 text-sm transition-colors duration-150',
              status === tab.value
                ? 'bg-primary-subtle font-medium text-primary-subtle-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {flash && (
        <p className="text-xs text-success" role="status">
          {flash}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {demo && (
        <p className="text-xs text-muted-foreground">
          演示模式下没有真实退款单；接入后端后，顾客在店面申请的退款会出现在这里。
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title={status === 'pending' ? '没有待处理的退款' : '没有退款单'}
          description={
            status === 'pending'
              ? '顾客申请退款后会出现在这里'
              : '换个状态页签看看'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">订单</th>
                <th scope="col" className="px-4 py-3 font-medium">顾客</th>
                <th scope="col" className="px-4 py-3 font-medium">金额</th>
                <th scope="col" className="px-4 py-3 font-medium">原因</th>
                <th scope="col" className="px-4 py-3 font-medium">来源</th>
                <th scope="col" className="px-4 py-3 font-medium">状态</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => {
                const meta = STATUS_META[item.status];
                return (
                  <tr key={item.id} className="transition-colors duration-150 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span className="block font-mono text-xs text-foreground">{item.orderId}</span>
                      <span className="block text-xs text-muted-foreground">{formatTime(item.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {item.customerEmail ?? '游客'}
                    </td>
                    <td className="tabular px-4 py-3">
                      {formatMoney(item.amountMinor, item.currencyCode)}
                    </td>
                    <td className="max-w-56 px-4 py-3">
                      <span className="block truncate text-sm text-foreground" title={item.reason}>
                        {item.reason}
                      </span>
                      {item.reviewNote && (
                        <span className="block truncate text-xs text-muted-foreground" title={item.reviewNote}>
                          处理说明：{item.reviewNote}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {item.source === 'customer' ? '顾客申请' : '商家发起'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {item.status === 'pending' ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            disabled={busyId === item.id}
                            onClick={() => void approve(item)}
                          >
                            <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                            同意
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === item.id}
                            onClick={() => {
                              setRejecting(item);
                              setRejectNote('');
                            }}
                          >
                            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
                            拒绝
                          </Button>
                        </div>
                      ) : (
                        <span className="block text-right text-xs text-muted-foreground">
                          {item.refundId ? '已打款' : '已处理'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-xs text-muted-foreground">共 {total} 条</span>
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="tabular text-muted-foreground">
            {page} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝退款</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              订单 <span className="font-mono text-foreground">{rejecting?.orderId}</span>，
              金额 {rejecting ? formatMoney(rejecting.amountMinor, rejecting.currencyCode) : ''}。
              拒绝后订单不会被退款，理由会展示给顾客。
            </p>
            <TextAreaField
              id="reject-note"
              label="拒绝理由"
              required
              placeholder="如：商品已发货，请收到后申请退货退款"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busyId === rejecting?.id || rejectNote.trim() === ''}
              onClick={() => void reject()}
            >
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
