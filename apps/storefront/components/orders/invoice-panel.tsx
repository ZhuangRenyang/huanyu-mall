'use client';

import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import { Badge, Button, formatMoney } from '@mall/ui';
import {
  loadOrderInvoice,
  requestOrderInvoice,
  type StoreInvoiceType,
  type StoreInvoiceView,
} from '@/lib/invoices';
import type { OrderStatusKey } from '@/lib/orders';

/**
 * 订单发票（ADR-098，淘宝「申请开票」）。
 *
 * 只在已付款的订单上出现。三种状态三种形态：
 *   - 没申请：一个「申请开票」按钮，展开表单填抬头；
 *   - 待开票：显示已提交的抬头，告诉顾客商家开好后会发到邮箱；
 *   - 已开票：显示发票号码（顾客可以直接拿去报销/查询）；
 *   - 已拒绝：显示原因，并说明要重新开票请联系商家（一张订单只能一张票）。
 *
 * 金额一律显示订单总额（服务端取），不接受顾客填。
 */
export function InvoicePanel({
  orderId,
  status,
  amountMinor,
  currencyCode,
  defaultEmail,
}: {
  orderId: string;
  status: OrderStatusKey;
  amountMinor: number;
  currencyCode: string;
  /** 默认收票邮箱（订单邮箱）。 */
  defaultEmail?: string;
}) {
  // 付款之后才能开票：待付款 / 退款中 / 已退款 / 已关闭都不显示
  const invoicable = status === 'to_ship' || status === 'to_receive' || status === 'completed';

  const [invoice, setInvoice] = useState<StoreInvoiceView | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<StoreInvoiceType>('personal');
  const [title, setTitle] = useState('');
  const [taxId, setTaxId] = useState('');
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoicable) return;
    let alive = true;
    void loadOrderInvoice(orderId).then((res) => {
      if (alive) setInvoice(res);
    });
    return () => {
      alive = false;
    };
  }, [orderId, invoicable]);

  if (!invoicable) return null;

  const submit = async () => {
    if (title.trim() === '') {
      setError('请填写发票抬头');
      return;
    }
    if (type === 'company' && taxId.trim() === '') {
      setError('企业发票必须填写税号');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestOrderInvoice(orderId, {
        type,
        title,
        taxId,
        email,
        remark,
      });
      setInvoice(await loadOrderInvoice(orderId));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <Receipt className="size-4" strokeWidth={2} aria-hidden="true" />
        发票
      </h3>

      {invoice ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge
              variant={
                invoice.status === 'issued'
                  ? 'success'
                  : invoice.status === 'rejected'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {invoice.status === 'issued'
                ? '已开票'
                : invoice.status === 'rejected'
                  ? '已拒绝'
                  : '待开票'}
            </Badge>
            <span className="text-sm text-foreground">
              {invoice.title}（{invoice.type === 'company' ? '企业' : '个人'}）
            </span>
          </div>
          {invoice.taxId && (
            <p className="font-mono text-xs text-muted-foreground">税号 {invoice.taxId}</p>
          )}
          <p className="text-xs text-muted-foreground">
            开票金额 {formatMoney(invoice.amountMinor, invoice.currencyCode)} · 电子票发送至{' '}
            {invoice.email}
          </p>
          {invoice.status === 'issued' && invoice.invoiceNo && (
            <p className="text-sm text-foreground">
              发票号码 <span className="font-mono">{invoice.invoiceNo}</span>
            </p>
          )}
          {invoice.status === 'pending' && (
            <p className="text-xs text-muted-foreground">
              商家开好票后会登记发票号码，可回到本页查看。
            </p>
          )}
          {invoice.status === 'rejected' && (
            <p className="text-xs text-muted-foreground">
              {invoice.reviewNote ?? '商家未通过开票申请'}
              。一张订单只能开一次票，需要重开请联系商家。
            </p>
          )}
        </div>
      ) : open ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {(
              [
                { value: 'personal' as const, label: '个人' },
                { value: 'company' as const, label: '企业' },
              ]
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={
                  type === t.value
                    ? 'rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground'
                    : 'rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted'
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="block text-xs font-medium text-muted-foreground">
            发票抬头
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === 'company' ? '企业名称' : '个人姓名'}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>

          {type === 'company' && (
            <label className="block text-xs font-medium text-muted-foreground">
              税号
              <input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="统一社会信用代码"
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
          )}

          <label className="block text-xs font-medium text-muted-foreground">
            收票邮箱
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="用于接收电子发票"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="block text-xs font-medium text-muted-foreground">
            备注（选填）
            <input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="如：请开明细"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>

          <p className="text-xs text-muted-foreground">
            开票金额 {formatMoney(amountMinor, currencyCode)}（按订单实付，不可修改）。
            提交后由商家线下开票并登记号码。
          </p>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void submit()} disabled={busy}>
              {busy ? '提交中…' : '提交开票申请'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            需要发票？提交抬头后商家会线下开票，开好可在本页看到发票号码。
          </p>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            申请开票
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
