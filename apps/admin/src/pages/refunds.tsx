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
  type RefundCounts,
  type RefundRequestView,
  type RefundStatus,
} from '@/lib/admin-refunds';

/**
 * 退款管理（对齐淘宝「交易 → 退款管理」）。
 *
 * 淘宝的流程是**卖家人工审核**：买家申请后订单冻结，卖家在退款管理里
 * 同意（真正打款）或拒绝（填理由）。这里按同一套走：
 *
 *   - 待处理排在最前，页签带数量 —— 商家打开就知道有几单要审；
 *   - 每行按「订单 → 退款信息 → 状态 → 操作」排列，和淘宝列表同序；
 *   - 「同意退款」是**最后一道闸**：点了才打款，所以确认框写明金额与不可撤销。
 *
 * 不做「超时自动同意」：淘宝有平台兜底，自建商城自动打款风险太大，
 * 宁可让单据停在待处理等商家处理。
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
  const [counts, setCounts] = useState<RefundCounts>({
    pending: 0,
    approved: 0,
    rejected: 0,
    canceled: 0,
    all: 0,
  });
  const [status, setStatus] = useState<RefundStatus | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<RefundRequestView | null>(null);
  const [approving, setApproving] = useState<RefundRequestView | null>(null);
  const [rejectNote, setRejectNote] = useState('');

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
      setCounts(res.counts);
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

  const approve = async () => {
    if (!approving) return;
    setBusyId(approving.id);
    setError(null);
    try {
      await approveRefundRequest(approving.id);
      setApproving(null);
      setFlash('已同意，退款已原路退回');
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
      setFlash('已拒绝该退款申请，订单已恢复');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const countOf = (value: RefundStatus | 'all'): number =>
    value === 'all' ? counts.all : counts[value];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">退款管理</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          顾客申请或商家发起后先进入待处理，订单同时暂停发货。
          <strong className="font-medium text-foreground">同意后才原路退款</strong>
          ，拒绝需填写理由（顾客可见）。
        </p>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="退款状态筛选">
        {STATUS_TABS.map((tab) => {
          const n = countOf(tab.value);
          return (
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
              {n > 0 && (
                <span
                  className={cn(
                    'ml-1 tabular text-xs',
                    // 待处理是唯一需要商家动手的，用告警色
                    tab.value === 'pending' ? 'font-medium text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
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

      {items.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title={status === 'pending' ? '没有待处理的退款' : '没有退款单'}
          description={
            status === 'pending'
              ? '顾客申请或商家在订单详情发起后，会出现在这里等你审核'
              : '换个状态页签看看'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">订单</th>
                <th scope="col" className="px-4 py-3 font-medium">退款金额</th>
                <th scope="col" className="px-4 py-3 font-medium">原因 / 处理说明</th>
                <th scope="col" className="px-4 py-3 font-medium">申请时间</th>
                <th scope="col" className="px-4 py-3 font-medium">状态</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => {
                const meta = STATUS_META[item.status];
                return (
                  <tr
                    key={item.id}
                    className={cn(
                      'transition-colors duration-150 hover:bg-muted/50',
                      // 待处理行轻微高亮：一眼扫出要动手的那几行
                      item.status === 'pending' && 'bg-warning-subtle/40',
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className="block font-mono text-xs text-foreground">{item.orderId}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {item.customerEmail ?? '游客'}
                        {item.source === 'merchant' ? ' · 商家发起' : ' · 顾客申请'}
                      </span>
                    </td>
                    <td className="tabular px-4 py-3 align-top">
                      {formatMoney(item.amountMinor, item.currencyCode)}
                    </td>
                    <td className="max-w-64 px-4 py-3 align-top">
                      <span className="block truncate text-sm text-foreground" title={item.reason}>
                        {item.reason}
                      </span>
                      {item.reviewNote && (
                        <span
                          className="mt-0.5 block truncate text-xs text-muted-foreground"
                          title={item.reviewNote}
                        >
                          处理说明：{item.reviewNote}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="tabular whitespace-nowrap text-xs text-muted-foreground">
                        {formatTime(item.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {item.status === 'pending' ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            disabled={busyId === item.id}
                            onClick={() => setApproving(item)}
                          >
                            <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                            同意退款
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
                          {item.status === 'approved'
                            ? item.refundId
                              ? '已打款'
                              : '已同意（无资金流水，请核对）'
                            : '已处理'}
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

      {/* 同意 = 真正打款，单独确认并写明金额 */}
      <Dialog open={approving !== null} onOpenChange={(open) => !open && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>同意退款</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              将向订单 <span className="font-mono text-foreground">{approving?.orderId}</span>{' '}
              原路退回{' '}
              <span className="tabular font-medium text-foreground">
                {approving ? formatMoney(approving.amountMinor, approving.currencyCode) : ''}
              </span>
              ，订单同时转为「已退款」。
            </p>
            <p className="text-sm text-destructive">
              退款一经提交无法撤销，请确认已收到退货或与顾客协商一致。
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproving(null)}>
              取消
            </Button>
            <Button disabled={busyId === approving?.id} onClick={() => void approve()}>
              {busyId === approving?.id ? '退款中…' : '确认同意并退款'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝退款</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              订单 <span className="font-mono text-foreground">{rejecting?.orderId}</span>，
              金额 {rejecting ? formatMoney(rejecting.amountMinor, rejecting.currencyCode) : ''}。
              拒绝后订单恢复为申请前的状态，理由会展示给顾客。
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
