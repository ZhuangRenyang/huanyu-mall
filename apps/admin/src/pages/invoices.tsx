import { useCallback, useEffect, useState } from 'react';
import { Check, Receipt, X } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  cn,
  formatMoney,
} from '@mall/ui';
import { TextAreaField } from '../components/field';
import {
  EMPTY_INVOICE_RESULT,
  issueInvoice,
  listInvoices,
  rejectInvoice,
  type InvoiceCounts,
  type InvoiceStatus,
  type InvoiceView,
} from '@/lib/admin-invoices';

/**
 * 发票管理（ADR-098，对齐淘宝「交易 → 发票管理」）。
 *
 * 不做自动开票：接税盘/服务商是外部依赖，先把业务闭环做扎实 ——
 * 顾客提交抬头 → 商家线下开票 → 这里登记发票号 → 顾客在订单页看到号码。
 *
 * 三条界面上必须说清的事：
 *   1. 登记开票只写号码，**不动钱、不动订单状态**；
 *   2. 发票号登记后不能改（红冲换开是线下流程），所以确认框要写明；
 *   3. 拒绝必须填原因，顾客看得到。
 */

const STATUS_META: Record<
  InvoiceStatus,
  { label: string; tone: 'warning' | 'success' | 'neutral' }
> = {
  pending: { label: '待开票', tone: 'warning' },
  issued: { label: '已开票', tone: 'success' },
  rejected: { label: '已拒绝', tone: 'neutral' },
};

const STATUS_TABS: Array<{ value: InvoiceStatus | 'all'; label: string }> = [
  { value: 'pending', label: '待开票' },
  { value: 'issued', label: '已开票' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部' },
];

export function InvoicesPage() {
  const [items, setItems] = useState<InvoiceView[]>([]);
  const [counts, setCounts] = useState<InvoiceCounts>(EMPTY_INVOICE_RESULT.counts);
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 开票对话框：填发票号。 */
  const [issuing, setIssuing] = useState<InvoiceView | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [issueNote, setIssueNote] = useState('');
  /** 拒绝对话框：填原因。 */
  const [rejecting, setRejecting] = useState<InvoiceView | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listInvoices({
        ...(status === 'all' ? {} : { status }),
        limit: 50,
      });
      setItems(res.items);
      setCounts(res.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载发票失败');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const doIssue = async () => {
    if (!issuing) return;
    if (invoiceNo.trim() === '') {
      setError('请填写发票号码');
      return;
    }
    setBusyId(issuing.id);
    setError(null);
    try {
      await issueInvoice(issuing.id, invoiceNo.trim(), issueNote.trim() || undefined);
      setIssuing(null);
      setInvoiceNo('');
      setIssueNote('');
      setFlash('已登记开票，顾客可在订单页看到发票号');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '开票失败');
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async () => {
    if (!rejecting) return;
    if (rejectNote.trim() === '') {
      setError('拒绝开票必须填写原因');
      return;
    }
    setBusyId(rejecting.id);
    setError(null);
    try {
      await rejectInvoice(rejecting.id, rejectNote.trim());
      setRejecting(null);
      setRejectNote('');
      setFlash('已拒绝开票，原因会展示给顾客');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const countOf = (value: InvoiceStatus | 'all'): number =>
    value === 'all' ? counts.all : counts[value];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">发票管理</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          顾客在订单页提交抬头后进入待开票。线下开好票，在这里登记发票号；顾客可在订单页看到号码。
          <strong className="font-medium text-foreground">登记只写号码，不影响订单与资金状态。</strong>
        </p>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="发票状态筛选">
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
          icon={Receipt}
          title={status === 'pending' ? '没有待开的发票' : '没有发票单'}
          description={
            status === 'pending'
              ? '顾客在订单页提交开票申请后，会出现在这里等你登记发票号'
              : '换个状态页签看看'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">订单</th>
                <th scope="col" className="px-4 py-3 font-medium">抬头 / 税号</th>
                <th scope="col" className="px-4 py-3 font-medium">金额</th>
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
                      // 待开票行轻微高亮：一眼扫出要动手的那几行
                      item.status === 'pending' && 'bg-warning-subtle/40',
                    )}
                  >
                    <td className="px-4 py-3 align-top">
                      <span className="block font-mono text-xs text-foreground">{item.orderId}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {item.type === 'company' ? '企业' : '个人'} · {item.email}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block text-foreground">{item.title}</span>
                      {item.taxId && (
                        <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                          {item.taxId}
                        </span>
                      )}
                      {item.remark && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          备注：{item.remark}
                        </span>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 align-top">
                      {formatMoney(item.amountMinor, item.currencyCode)}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                      {item.createdAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                      {item.invoiceNo && (
                        <span className="mt-1 block font-mono text-xs text-muted-foreground">
                          {item.invoiceNo}
                        </span>
                      )}
                      {item.reviewNote && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.reviewNote}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      {item.status === 'pending' ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" disabled={busyId === item.id} onClick={() => setIssuing(item)}>
                            <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                            登记开票
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === item.id}
                            onClick={() => setRejecting(item)}
                          >
                            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
                            拒绝
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {item.status === 'issued' ? '已开票' : '已拒绝'}
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

      {/* 登记开票 */}
      <Dialog open={issuing !== null} onOpenChange={(open) => !open && setIssuing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记开票</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              订单 <span className="font-mono text-foreground">{issuing?.orderId}</span> · 抬头{' '}
              <span className="text-foreground">{issuing?.title}</span>
              {issuing ? ` · ${formatMoney(issuing.amountMinor, issuing.currencyCode)}` : ''}
            </p>
            <label className="block text-xs font-medium text-muted-foreground">
              发票号码
              <input
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                placeholder="线下开出的发票号码"
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <TextAreaField
              id="invoice-issue-note"
              label="备注（选填）"
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
              rows={2}
              placeholder="如：纸质票已寄出"
            />
            <p className="text-xs text-muted-foreground">
              登记后发票号不能再改（红冲换开属线下流程），请核对无误再提交。
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIssuing(null)}>
              取消
            </Button>
            <Button disabled={busyId === issuing?.id} onClick={() => void doIssue()}>
              {busyId === issuing?.id ? '处理中…' : '确认已开票'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拒绝开票 */}
      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝开票</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              拒绝原因会展示给顾客，请写清具体依据（如抬头与付款人不一致）。
            </p>
            <TextAreaField
              id="invoice-reject-note"
              label="拒绝原因"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              placeholder="如：抬头与付款人不一致"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busyId === rejecting?.id}
              onClick={() => void doReject()}
            >
              {busyId === rejecting?.id ? '处理中…' : '确认拒绝'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
