'use client';

import { useState } from 'react';
import { Copy, CreditCard, MapPin, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, formatMoney } from '@mall/ui';
import { OrderTimeline } from './order-timeline';
import { ORDER_STATUS_META, formatDateTime, type OrderView } from '@/lib/orders';

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
      </div>
    </div>
  );
}
