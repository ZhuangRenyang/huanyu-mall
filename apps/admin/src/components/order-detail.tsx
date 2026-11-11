import { useEffect, useState } from 'react';
import { Check, CreditCard, MapPin, RotateCcw, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatMoney,
  cn,
} from '@mall/ui';
import { TextField, SelectField } from './field';
import {
  listOrderFulfillments,
  listOrderReservations,
  listStockLocations,
  refundOrder,
  shipOrder,
} from '@/lib/admin-api';
import type { OrderFulfillmentView, OrderReservationView, StockLocationView } from '@/lib/admin-api';
import { FUL_META, PAY_META } from '@/lib/admin-meta';
import type { AdminOrder } from '@/lib/admin-data';

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
    <div className="rounded-lg border border-border p-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function Timeline({ order }: { order: AdminOrder }) {
  const steps = [
    { label: '已下单', done: true },
    { label: '已付款', done: order.paymentStatus === 'paid' || order.paymentStatus === 'refunded' },
    { label: '已发货', done: order.fulfillmentStatus === 'shipped' || order.fulfillmentStatus === 'delivered' },
    { label: '已签收', done: order.fulfillmentStatus === 'delivered' },
  ];
  const lastDone = steps.reduce((acc, s, i) => (s.done ? i : acc), -1);
  return (
    <ol className="grid grid-cols-4" role="list" aria-label="订单状态">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-col items-center text-center" aria-current={i === lastDone ? 'step' : undefined}>
          {i < steps.length - 1 && (
            <span className={cn('absolute left-1/2 top-3 h-px w-full', steps[i + 1]?.done ? 'bg-primary' : 'bg-border')} aria-hidden="true" />
          )}
          <span
            className={cn(
              'relative z-10 grid size-6 place-items-center rounded-full text-xs',
              i === lastDone ? 'bg-primary text-primary-foreground' : s.done ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground',
            )}
            aria-hidden="true"
          >
            {s.done && i !== lastDone ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
          </span>
          <span className={cn('mt-1.5 text-xs', i === lastDone ? 'font-medium text-foreground' : 'text-muted-foreground')}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** 订单详情（Sheet 内）：状态/时间线 + 商品/金额 + 客户/地址/支付 + 发货/退款。 */
export function OrderDetail({ order, onUpdated }: { order: AdminOrder; onUpdated: () => void }) {
  const [showShip, setShowShip] = useState(false);
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [tracking, setTracking] = useState(order.trackingNumber ?? '');
  const [shipError, setShipError] = useState<string | null>(null);
  const [reservations, setReservations] = useState<OrderReservationView[]>([]);
  const [fulfillments, setFulfillments] = useState<OrderFulfillmentView[]>([]);
  const [locations, setLocations] = useState<StockLocationView[]>([]);
  const [resLoading, setResLoading] = useState(false);
  const [shipLocationId, setShipLocationId] = useState('');
  /** 多仓时每行的分配件数（键 = 行下标，值 = 输入框原文）。 */
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundInput, setRefundInput] = useState('');
  const [refundError, setRefundError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };
  const pay = PAY_META[order.paymentStatus];
  const ful = FUL_META[order.fulfillmentStatus];
  const idTail = order.id.slice(-4);

  // —— 按仓发货（ADR-013 §3）：本单预留落在几个仓、已发过哪些仓，决定表单形态 ——
  const reservedLocationIds = [...new Set(reservations.map((r) => r.locationId))];
  const shippedLocationIds = new Set(
    fulfillments.map((f) => f.locationId).filter((id): id is string => Boolean(id)),
  );
  const pendingLocationIds = reservedLocationIds.filter((id) => !shippedLocationIds.has(id));
  const multiLocation = pendingLocationIds.length > 1;
  // 预留读不到时退回订单状态判断，避免发货入口凭空消失。
  const canShip =
    reservedLocationIds.length > 0
      ? pendingLocationIds.length > 0
      : order.fulfillmentStatus === 'unfulfilled';
  const reservedAtSelected = reservations
    .filter((r) => r.locationId === shipLocationId)
    .reduce((n, r) => n + r.quantity, 0);
  const allocatedTotal = order.items.reduce((n, _it, i) => {
    const qty = Number(alloc[String(i)] ?? '');
    return n + (Number.isInteger(qty) && qty > 0 ? qty : 0);
  }, 0);
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  const loadShipContext = async () => {
    // 任一接口不可用时退回旧行为（单仓简单表单 / 由后端裁决），不阻断发货入口。
    const [res, locs, fulfs] = await Promise.all([
      listOrderReservations(order.id).catch(() => [] as OrderReservationView[]),
      listStockLocations().catch(() => [] as StockLocationView[]),
      listOrderFulfillments(order.id).catch(() => [] as OrderFulfillmentView[]),
    ]);
    setReservations(res);
    setLocations(locs);
    setFulfillments(fulfs);
    const shipped = new Set(fulfs.map((f) => f.locationId).filter(Boolean));
    const firstPending = [...new Set(res.map((r) => r.locationId))].find((id) => !shipped.has(id));
    setShipLocationId(firstPending ?? '');
    return fulfs;
  };

  useEffect(() => {
    setResLoading(true);
    void loadShipContext().finally(() => setResLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在订单切换时重载
  }, [order.id]);

  const openShip = async () => {
    setShowShip(true);
    setShipError(null);
    setAlloc({});
    setResLoading(true);
    await loadShipContext();
    setResLoading(false);
  };

  const doShip = async () => {
    setShipError(null);
    if (!carrier.trim() || !tracking.trim()) {
      setShipError('请填写承运商与运单号');
      return;
    }
    try {
      if (multiLocation) {
        if (!shipLocationId) {
          setShipError('请选择发货仓');
          return;
        }
        const invalid = order.items.some((_it, i) => {
          const raw = (alloc[String(i)] ?? '').trim();
          if (!raw) return false;
          const qty = Number(raw);
          return !Number.isInteger(qty) || qty < 0;
        });
        if (invalid) {
          setShipError('每行数量必须是非负整数');
          return;
        }
        const items = order.items
          .map((li, i) => ({ order_line_item_id: li.id ?? '', quantity: Number(alloc[String(i)] ?? '0') || 0 }))
          .filter((it) => it.quantity > 0);
        const allocated = items.reduce((n, it) => n + it.quantity, 0);
        // 只校验总和（ADR-013 §3：发货数量必须等于该仓预留数量），够不够由后端裁决。
        if (allocated !== reservedAtSelected) {
          setShipError(`本仓需发 ${reservedAtSelected} 件，当前分配 ${allocated} 件`);
          return;
        }
        await shipOrder(order.id, carrier.trim(), tracking.trim(), {
          stockLocationId: shipLocationId,
          items,
        });
      } else {
        await shipOrder(
          order.id,
          carrier.trim(),
          tracking.trim(),
          pendingLocationIds.length === 1 ? { stockLocationId: pendingLocationIds[0] } : undefined,
        );
      }
      setShowShip(false);
      setAlloc({});
      setShipError(null);
      await loadShipContext();
      flash('已发货');
      onUpdated();
    } catch (err) {
      setShipError(err instanceof Error ? err.message : '发货失败，请稍后重试');
    }
  };

  const doRefund = async () => {
    if (refundInput.trim() !== idTail) {
      setRefundError(`请输入订单号后四位「${idTail}」以确认`);
      return;
    }
    await refundOrder(order.id);
    setRefundOpen(false);
    setRefundInput('');
    setRefundError(null);
    flash('已发起全额退款');
    onUpdated();
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant={pay.variant}>{pay.label}</Badge>
          <Badge variant={ful.variant}>{ful.label}</Badge>
          {toast && (
            <span className="text-xs text-success" role="status">
              {toast}
            </span>
          )}
        </div>
        <Timeline order={order} />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">商品</h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {order.items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {it.title}
                {it.variantTitle ? ` · ${it.variantTitle}` : ''} × {it.quantity}
              </span>
              <span className="tabular shrink-0">{formatMoney(it.unitPriceMinor * it.quantity, order.currency)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 rounded-lg border border-border p-3 text-sm">
          <Row label="商品小计" value={formatMoney(order.subtotalMinor, order.currency)} />
          <Row label="运费" value={order.shippingMinor === 0 ? '免运费' : formatMoney(order.shippingMinor, order.currency)} />
          <Row label="税费" value={order.taxMinor === 0 ? '含税' : formatMoney(order.taxMinor, order.currency)} />
          <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
            <dt>实付</dt>
            <dd className="tabular">{formatMoney(order.totalMinor, order.currency)}</dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <InfoCard icon={MapPin} title="收货地址">
          <p className="text-sm text-foreground">{order.customerName}</p>
          <p className="text-xs text-muted-foreground">{order.customerEmail}</p>
          <p className="mt-1 text-sm text-muted-foreground">{order.shippingAddress}</p>
        </InfoCard>
        <InfoCard icon={CreditCard} title="支付信息">
          <p className="text-sm text-foreground">微信支付</p>
          <p className="text-xs text-muted-foreground">金额 {formatMoney(order.totalMinor, order.currency)}</p>
          {order.trackingNumber && (
            <p className="mt-1 text-xs text-muted-foreground">
              {order.carrier} · {order.trackingNumber}
            </p>
          )}
        </InfoCard>
      </div>

      {fulfillments.length > 0 && (
        <section aria-label="已发货记录">
          <h3 className="mb-2 text-sm font-semibold text-foreground">已发货</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {fulfillments.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{f.locationId ? locationName(f.locationId) : '未标记仓库'}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {f.carriers.length > 0
                    ? f.carriers.map((c) => `${c.carrier} · ${c.number}`).join('，')
                    : '待填运单'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {order.fulfillmentStatus === 'unfulfilled' && (
          <Button size="sm" onClick={() => void openShip()}>
            <Truck className="size-4" strokeWidth={2} aria-hidden="true" />
            发货
          </Button>
        )}
        {order.paymentStatus === 'paid' && (
          <Button size="sm" variant="destructive" onClick={() => setRefundOpen(true)}>
            <RotateCcw className="size-4" strokeWidth={2} aria-hidden="true" />
            全额退款
          </Button>
        )}
      </div>

      {showShip && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          {resLoading && <p className="text-xs text-muted-foreground">正在查询本单的仓库预留…</p>}

          <TextField id="ship-carrier" label="承运商" required value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="如 顺丰国际" />
          <TextField id="ship-tracking" label="运单号" required value={tracking} onChange={(e) => setTracking(e.target.value)} className="font-mono" />

          {multiLocation && (
            <>
              <SelectField
                id="ship-location"
                label="发货仓"
                required
                value={shipLocationId}
                onChange={(e) => {
                  setShipLocationId(e.target.value);
                  // 换仓等于换一组预留，之前的分配必须清空，避免拿旧数字骗过总和校验。
                  setAlloc({});
                  setShipError(null);
                }}
                options={pendingLocationIds.map((id) => ({ value: id, label: locationName(id) }))}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                本仓预留合计 <span className="tabular font-medium text-foreground">{reservedAtSelected}</span> 件，请分配到各商品行。
                一张发货单只发一个仓，另一个仓请再发一次。
              </p>
              <div className="space-y-2">
                {order.items.map((it, i) => (
                  <TextField
                    key={i}
                    id={`ship-alloc-${i}`}
                    label={`${it.title}${it.variantTitle ? ` · ${it.variantTitle}` : ''}（整单 ${it.quantity} 件）`}
                    inputMode="numeric"
                    value={alloc[String(i)] ?? ''}
                    onChange={(e) => setAlloc((prev) => ({ ...prev, [String(i)]: e.target.value }))}
                    placeholder="0"
                    className="w-24"
                  />
                ))}
              </div>
              <p
                className={cn(
                  'text-xs',
                  allocatedTotal === reservedAtSelected ? 'text-muted-foreground' : 'text-destructive',
                )}
                role="status"
              >
                已分配 <span className="tabular">{allocatedTotal}</span> / {reservedAtSelected} 件
              </p>
            </>
          )}

          {!resLoading && reservations.length === 0 && (
            <p className="text-xs text-muted-foreground">未查询到预留明细，按整单发货（单仓兼容）。</p>
          )}

          {shipError && (
            <p className="text-xs text-destructive" role="alert">
              {shipError}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void doShip()} disabled={resLoading}>
              确认发货
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowShip(false)}>
              取消
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={refundOpen}
        onOpenChange={(next) => {
          if (next) return;
          setRefundOpen(false);
          setRefundInput('');
          setRefundError(null);
        }}
      >
        <DialogContent>
          <DialogHeader className="mb-3">
            <DialogTitle>确认全额退款</DialogTitle>
          </DialogHeader>
          <p className="mb-3 text-sm text-muted-foreground">一期仅支持全额退款，退款将原路返回至顾客支付账户。</p>
          <TextField
            id="refund-confirm"
            label={`输入订单号后四位「${idTail}」以确认`}
            value={refundInput}
            onChange={(e) => setRefundInput(e.target.value)}
            error={refundError ?? undefined}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRefundOpen(false);
                setRefundInput('');
                setRefundError(null);
              }}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={doRefund}>
              确认退款 {formatMoney(order.totalMinor, order.currency)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
