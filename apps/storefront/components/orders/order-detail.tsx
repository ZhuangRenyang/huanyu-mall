'use client';

import { useEffect, useState } from 'react';
import { Copy, CreditCard, MapPin, MessageSquareText, Repeat, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Button, formatMoney } from '@mall/ui';
import {
  loadOrderRefunds,
  requestOrderRefund,
  submitReturnShipment,
  type StoreRefundResolution,
  type StoreRefundView,
} from '@/lib/refunds';
import { OrderTimeline } from './order-timeline';
import { ReviewDialog } from './review-dialog';
import {
  ORDER_STATUS_META,
  buyAgainLines,
  confirmReceipt,
  formatDateTime,
  type OrderView,
} from '@/lib/orders';
import { useCart } from '@/lib/cart-store';

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
  returnAddress,
}: {
  orderId: string;
  status: OrderView['status'];
  amountMinor: number;
  currencyCode: string;
  /** 店铺退货地址（ADR-053，可空）。 */
  returnAddress?: string | null;
}) {
  const [refunds, setRefunds] = useState<StoreRefundView[]>([]);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState<StoreRefundResolution>('refund_only');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** 退货物流（商家同意退货后由顾客填写，ADR-051）。 */
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');

  const refundable = status === 'to_ship' || status === 'to_receive' || status === 'completed';
  /*
   * 只有已发货/已收货的订单才能选「退货退款」——
   * 未发货的订单买家手里没货可寄，选了会卡在「等寄回」出不来。
   * 服务端同样拦（createRefundRequest），这里只是别让顾客白选一次。
   */
  const canReturn = status === 'to_receive' || status === 'completed';

  const refresh = () => {
    void loadOrderRefunds(orderId).then(setRefunds);
  };

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

  const active = refunds.find(
    (r) => r.status === 'pending' || r.status === 'awaiting_return' || r.status === 'returned',
  );
  const approved = refunds.find((r) => r.status === 'approved');
  const rejected = refunds.find((r) => r.status === 'rejected');

  // 商家已同意退货：顾客要在这里寄回并填单号，钱不会在货回来前先退
  if (active?.status === 'awaiting_return') {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">退货退款 · 请寄回商品</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          商家已同意退货。请把商品寄回（包装与配件齐全），寄出后在这里填写物流信息，
          商家确认收到货后才会退款。
        </p>
        {/*
          寄回地址：不显示它，顾客只能去问客服 —— 这是退货流程里最容易断的一环（ADR-053）。
          优先用**同意那一刻的快照**（ADR-061）：商家后来改地址，这一单仍按当初那个寄。
          店铺当前配置只作兜底（老单据没有快照）。没配就明说「联系客服」，别留空白让人猜。
        */}
        <div className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2">
          <p className="text-xs font-medium text-foreground">寄回地址</p>
          {active.returnAddress ?? returnAddress ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
              {active.returnAddress ?? returnAddress}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              店铺尚未填写退货地址，请联系客服获取后再寄回。
            </p>
          )}
          {active.returnAddress && (
            <p className="mt-1 text-xs text-muted-foreground">
              这是商家同意退货时给出的地址，之后改动店铺设置不影响本单。
            </p>
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            物流公司
            <input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="如：顺丰"
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            退货单号
            <input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="快递单号"
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
        </div>
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          className="mt-3"
          size="sm"
          disabled={busy || carrier.trim() === '' || tracking.trim().length < 4}
          onClick={() => {
            setBusy(true);
            setError(null);
            void submitReturnShipment(active.id, carrier, tracking)
              .then(() => {
                setCarrier('');
                setTracking('');
                refresh();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : '提交失败'))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? '提交中…' : '已寄出，提交单号'}
        </Button>
      </section>
    );
  }

  if (active?.status === 'returned') {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">退货退款 · 已寄回</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          退货物流：{active.returnCarrier} {active.returnTrackingNumber}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          等待商家确认收货，确认后原路退款。到账时间以支付渠道为准（通常 1–3 个工作日）。
        </p>
      </section>
    );
  }

  if (active?.status === 'pending' || done) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">退款申请</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {active?.resolution === 'return_refund' || resolution === 'return_refund'
            ? '已提交退货退款申请，商家同意后请把商品寄回并填写退货单号。'
            : '已提交仅退款申请，商家处理中。处理结果会显示在这里，也会通知到你的邮箱。'}
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
          {/* 售后类型：淘宝同一组选项。未发货的订单不出现「退货退款」 */}
          <fieldset>
            <legend className="mb-1 block text-xs font-medium text-foreground">售后类型</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: 'refund_only' as const, label: '仅退款', hint: '货不用寄回' },
                  ...(canReturn
                    ? [{ value: 'return_refund' as const, label: '退货退款', hint: '需寄回商品' }]
                    : []),
                ]
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={
                    resolution === opt.value
                      ? 'flex cursor-pointer items-center gap-1.5 rounded-md border border-primary bg-primary-subtle px-2.5 py-1.5 text-xs text-foreground'
                      : 'flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted'
                  }
                >
                  <input
                    type="radio"
                    name="refund-resolution"
                    value={opt.value}
                    checked={resolution === opt.value}
                    onChange={() => setResolution(opt.value)}
                    className="size-3.5"
                  />
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-muted-foreground">· {opt.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
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
            {resolution === 'return_refund'
              ? `将全额退回 ${formatMoney(amountMinor, currencyCode)}：商家同意后请把商品寄回，确认收到货后原路退款。`
              : `将全额退回 ${formatMoney(amountMinor, currencyCode)}，商家同意后原路退回。`}
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
                void requestOrderRefund(orderId, reason.trim(), resolution)
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
export function OrderDetail({
  order,
  returnAddress = null,
  onUpdated,
}: {
  order: OrderView;
  /** 店铺退货地址（ADR-053）：退货退款时顾客照着寄回。 */
  returnAddress?: string | null;
  /** 状态变化后让父组件重新拉一次订单（确认收货用）。 */
  onUpdated?: () => void;
}) {
  const meta = ORDER_STATUS_META[order.status];
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  /** 已评价的商品：初始来自订单详情，提交成功后本地追加（不用整页刷新）。 */
  const [reviewed, setReviewed] = useState<string[]>(order.reviewedProductIds ?? []);
  const [reviewTarget, setReviewTarget] = useState<{ productId: string; title: string } | null>(null);
  /*
   * 只有「已收货/已完成」能评价 —— 与服务端 REVIEWABLE_STATUSES 同一口径。
   * 前端藏按钮只是体验；绕过它服务端仍会拒。
   */
  const canReview = order.status === 'to_receive' || order.status === 'completed';

  /*
   * 再买一次（ADR-058）：淘宝在每个订单上都有这个入口 ——
   * 复购是最高频的动作，让顾客从「我的订单」重新找商品再选规格，纯属多余。
   */
  const { addItem } = useCart();
  const [buyNote, setBuyNote] = useState<string | null>(null);
  const again = buyAgainLines(order);

  const buyAgain = () => {
    for (const line of again.lines) {
      addItem(
        {
          id: line.variantId,
          title: line.title,
          ...(line.variantTitle ? { variantTitle: line.variantTitle } : {}),
          unitPriceMinor: line.unitPriceMinor,
          currencyCode: order.currencyCode,
        },
        line.quantity,
      );
    }
    /*
     * 只说「已加入」，不说「都加好了」：
     * 加购是乐观更新，缺货的那件要等服务端回来才知道（回来时会被回退并提示）。
     * 历史订单里没有变体 id 的行更是压根加不进来 —— 都要如实说。
     */
    setBuyNote(
      again.skipped > 0
        ? `已加入购物车；另有 ${again.skipped} 件规格信息不全，请到商品页重新选择`
        : '已加入购物车；缺货商品会自动移出',
    );
  };

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

      {/* 确认收货（ADR-049）：淘宝在「待收货」里给一个按钮，确认后交易完成、可评价 */}
      {order.status === 'to_receive' && (
        <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="confirm-heading">
          <h2 id="confirm-heading" className="text-sm font-medium text-foreground">
            收到货了吗？
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            确认收货后交易完成，就可以评价了。请先在包裹里核对商品与数量。
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              disabled={confirming}
              onClick={() => {
                if (!window.confirm('确认已经收到货？确认后交易将标记为完成。')) return;
                setConfirming(true);
                setConfirmError(null);
                void confirmReceipt(order.id)
                  .then(() => onUpdated?.())
                  .catch((err: unknown) => {
                    setConfirmError(err instanceof Error ? err.message : '操作失败，请稍后再试');
                  })
                  .finally(() => setConfirming(false));
              }}
            >
              {confirming ? '处理中…' : '确认收货'}
            </Button>
          </div>
          {confirmError && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {confirmError}
            </p>
          )}
        </section>
      )}

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
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tabular">{formatMoney(item.unitPriceMinor * item.quantity, order.currencyCode)}</span>
                  {canReview &&
                    item.productId &&
                    (reviewed.includes(item.productId) ? (
                      <span className="text-xs text-muted-foreground">已评价</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setReviewTarget({ productId: item.productId!, title: item.title })
                        }
                        className="rounded border border-border px-2 py-0.5 text-xs text-foreground transition-colors duration-150 hover:bg-muted"
                      >
                        评价
                      </button>
                    ))}
                </span>
              </li>
            ))}
          </ul>

          {/* 再买一次：放在金额下面，顾客看完这单花了多少，顺手复购 */}
          {again.lines.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={buyAgain}>
                <Repeat className="size-3.5" strokeWidth={2} aria-hidden="true" />
                再买一次
              </Button>
              {buyNote && (
                <span className="text-xs text-muted-foreground" role="status">
                  {buyNote}
                </span>
              )}
            </div>
          )}

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
          {/* 顾客自己写的留言：淘宝订单详情里原样回显，让他确认「我说的话商家看得到」 */}
          {order.customerNote && (
            <InfoCard icon={MessageSquareText} title="给卖家留言">
              <p className="whitespace-pre-wrap text-sm text-foreground">{order.customerNote}</p>
            </InfoCard>
          )}
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
          returnAddress={returnAddress}
        />
      </div>

      <ReviewDialog
        open={reviewTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReviewTarget(null);
        }}
        orderId={order.id}
        productId={reviewTarget?.productId ?? ''}
        productTitle={reviewTarget?.title ?? ''}
        onDone={() => {
          if (reviewTarget) setReviewed((prev) => [...prev, reviewTarget.productId]);
        }}
      />
    </div>
  );
}
