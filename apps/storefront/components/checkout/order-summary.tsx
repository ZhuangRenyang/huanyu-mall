import { formatMoney } from '@mall/ui';
import type { CartLineItemProps } from '@mall/ui';

export interface OrderSummaryProps {
  items: CartLineItemProps[];
  subtotal: { amountMinor: number; currencyCode: string };
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currencyCode: string;
  shippingLabel?: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd className="tabular ml-2 shrink-0">{value}</dd>
    </div>
  );
}

function SummaryBody({ items, subtotal, shippingMinor, taxMinor, totalMinor, currencyCode, shippingLabel }: OrderSummaryProps) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs text-muted-foreground">
              {item.quantity}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {item.title}
              {item.variantTitle ? ` · ${item.variantTitle}` : ''}
            </span>
            <span className="tabular shrink-0">{formatMoney(item.unitPriceMinor * item.quantity, currencyCode)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
        <Row label="小计" value={formatMoney(subtotal.amountMinor, currencyCode)} />
        <Row
          label={shippingLabel ? `运费（${shippingLabel}）` : '运费'}
          value={shippingMinor === 0 ? '免运费' : formatMoney(shippingMinor, currencyCode)}
        />
        <Row label="税费" value={taxMinor === 0 ? '含税' : formatMoney(taxMinor, currencyCode)} />
        <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
          <dt>合计</dt>
          <dd className="tabular">{formatMoney(totalMinor, currencyCode)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** 订单摘要：移动折叠面板 / 桌面 sticky 侧栏（同一 body 两处渲染）。 */
export function OrderSummary(props: OrderSummaryProps) {
  return (
    <>
      <details className="rounded-lg border border-border bg-card p-4 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
          <span>订单摘要</span>
          <span className="tabular font-semibold">{formatMoney(props.totalMinor, props.currencyCode)}</span>
        </summary>
        <div className="mt-3">
          <SummaryBody {...props} />
        </div>
      </details>

      <aside className="hidden lg:block lg:sticky lg:top-[calc(var(--chrome-offset)+1rem)] lg:self-start">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold">订单摘要</h2>
          <SummaryBody {...props} />
        </div>
      </aside>
    </>
  );
}
