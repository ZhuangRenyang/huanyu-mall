'use client';

import { useEffect, useState } from 'react';
import { Copy, CreditCard, MapPin, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Button, formatMoney } from '@mall/ui';
import { loadOrderRefunds, requestOrderRefund, type StoreRefundView } from '@/lib/refunds';
import { OrderTimeline } from './order-timeline';
import { ORDER_STATUS_META, formatDateTime, type OrderView } from '@/lib/orders';

/**
 * 申请退款（淘宝「申请售后」）。
 *
 * 只在已付款的订单上出现；提交后是「待商家处理」，不是立即到账。
 * 已有申请时显示进度，避免顾客重复申请。
 */
function RefundPanel({
  orderId,
  status,
  amountMinor,
  currencyCode,
}: {
  orderId: string;
  status: OrderView['status'];
  amountMinor: number;
  currencyCode: string;
}) {
  const [refunds, setRefunds] = useState<StoreRefundView[]>([]);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const refundable = status === 'to_ship' || status === 'to_receive' || status === 'completed';

  useEffect(() => {
    if (!refundable) return;
    let cancelled = false;
    void loadOrderRefunds(orderId).then((rows) => {
      if (!cancelled) setRefunds(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, refundable]);

  if (!refundable) return null;

  const pending = refunds.find((r) => r.status === 'pending');
  const approved = refunds.find((r) => r.status === 'approved');
  const rejected = refunds.find((r) => r.status === 'rejected');

  if (pending || done) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">退款申请</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          已提交，商家处理中。处理结果会显示在这里，也会通知到你的邮箱。
        </p>
      </section>
    );
  }

  if (approved) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">退款申请</h3>
        <p className="mt-1 text-sm text-success">
          退款已原路退回，到账时间以支付渠道为准（通常 1–3 个工作日）。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">需要退款？</h3>
      {rejected && (
        <p className="mt-1 text-sm text-muted-foreground">
          上次申请已被拒绝：{rejected.reviewNote ?? '（商家未填写理由）'}
        </p>
      )}
      {!open ? (
        <Button className="mt-3" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          申请退款
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <label htmlFor="refund-reason" className="block text-xs font-medium text-foreground">
            退款原因
          </label>
          <textarea
            id="refund-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="如：不想要了 / 商品有瑕疵 / 发错货"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
          <p className="text-xs text-muted-foreground">
            将全额退回 {formatMoney(amountMinor, currencyCode)}，商家同意后原路退回。
          </p>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy || reason.trim().length < 2}
              onClick={() => {
                setBusy(true);
                setError(null);
                void requestOrderRefund(orderId, reason.trim())
                  .then(() => {
                    setOpen(false);
                    setDone(true);
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : '提交失败'))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? '提交中…' : '提交申请'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用 */
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span className="tabular font-mono text-sm text-foreground">{text}</span>
      <button
        type="button"
        aria-label={`复制${label}`}
        onClick={copy}
        className="grid size-7 place-items-center rounded text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <Copy className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? '已复制' : ''}
      </span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function InfoCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
        {title}
      </h3>
      {children}
    </div>
  );
}

/** 订单详情：状态+时间线 → 商品/金额（左）+ 地址/配送/支付（右）。 */
export function OrderDetail({ order }: { order: OrderView }) {
  const meta = ORDER_STATUS_META[order.status];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">订单详情</h1>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          订单号 <CopyText text={order.id} label="订单号" />
        </p>
        <p className="text-sm text-muted-foreground">下单时间 {formatDateTime(order.createdAt)}</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <OrderTimeline items={order.timeline} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[8fr_4fr]">
        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {order.items.map((item, i) => (
              <li key={i} className="flex items-center gap-3 p-4 text-sm">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} loading="lazy" className="aspect-square w-12 shrink-0 rounded-sm object-cover" />
                ) : (
                  <div className="aspect-square w-12 shrink-0 rounded-sm bg-secondary" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">{item.title}</span>
                  {item.variantTitle && <span className="block text-xs text-muted-foreground">{item.variantTitle}</span>}
                  <span className="block text-xs text-muted-foreground">× {item.quantity}</span>
                </span>
                <span className="tabular shrink-0">{formatMoney(item.unitPriceMinor * item.quantity, order.currencyCode)}</span>
              </li>
            ))}
          </ul>

          <dl className="space-y-1.5 rounded-lg border border-border bg-card p-4 text-sm">
            <Row label="商品小计" value={formatMoney(order.subtotalMinor, order.currencyCode)} />
            <Row label="运费" value={order.shippingMinor === 0 ? '免运费' : formatMoney(order.shippingMinor, order.currencyCode)} />
            <Row label="税费" value={order.taxMinor === 0 ? '含税' : formatMoney(order.taxMinor, order.currencyCode)} />
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>实付</dt>
              <dd className="tabular">{formatMoney(order.totalMinor, order.currencyCode)}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-4">
          <InfoCard icon={MapPin} title="收货地址">
            <p className="text-sm text-foreground">
              {order.contactName} · {order.contactPhone}
            </p>
            <p className="text-sm text-muted-foreground">
              {order.shippingRegion} {order.shippingLine1}
            </p>
          </InfoCard>
          <InfoCard icon={Truck} title="配送方式">
            <p className="text-sm text-foreground">{order.shippingOptionName}</p>
            {order.tracking && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                {order.tracking.carrier}
                <CopyText text={order.tracking.number} label="物流单号" />
              </p>
            )}
          </InfoCard>
          <InfoCard icon={CreditCard} title="支付方式">
            <p className="text-sm text-foreground">{order.paymentMethod}</p>
          </InfoCard>
        </div>

        <RefundPanel
          orderId={order.id}
          status={order.status}
          amountMinor={order.totalMinor}
          currencyCode={order.currencyCode}
        />
      </div>
    </div>
  );
}
