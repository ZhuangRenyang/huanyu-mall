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
import { TextAreaField, TextField } from './field';
import {
  getFulfillmentPlan,
  listOrderFulfillments,
  listStockLocations,
  requestOrderRefund,
  shipOrder,
  setOrderNote,
  listOrderLogs,
} from '@/lib/admin-api';
import type {
  FulfillmentPlanView,
  OrderFulfillmentView,
  StockLocationView,
} from '@/lib/admin-api';
import type { AdminOrderLog } from '@/lib/admin-data';
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
    {
      label: '已发货',
      done:
        order.fulfillmentStatus === 'partial' ||
        order.fulfillmentStatus === 'shipped' ||
        order.fulfillmentStatus === 'delivered',
    },
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
  const [plans, setPlans] = useState<FulfillmentPlanView[]>([]);
  const [fulfillments, setFulfillments] = useState<OrderFulfillmentView[]>([]);
  const [locations, setLocations] = useState<StockLocationView[]>([]);
  /** 每个仓独立的承运商 / 运单号（一仓一单，运单号不能共用）。 */
  const [forms, setForms] = useState<Record<string, { carrier: string; tracking: string }>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundInput, setRefundInput] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundError, setRefundError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** 商家备注：draft 与已存值分开，避免一边打字一边被刷新覆盖。 */
  const [noteDraft, setNoteDraft] = useState(order.merchantNote ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [logs, setLogs] = useState<AdminOrderLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };
  const pay = PAY_META[order.paymentStatus];
  const ful = FUL_META[order.fulfillmentStatus];
  const idTail = order.id.slice(-4);

  // 后端按预留算出「每个仓发哪些行、各几件」；前端不再选仓、不再分行。
  /** 退款审核中 / 已退款：两个状态都不能发货。 */
  const refundPending = order.orderStatus === 'refund_pending';
  const refunded = order.orderStatus === 'refunded' || order.paymentStatus === 'refunded';
  const canShip =
    order.paymentStatus === 'paid' && !refundPending && !refunded && (!planLoaded || plans.length > 0);
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  // 备注跟着订单走：切换订单要重置输入，否则会把上一单的备注写到这一单
  useEffect(() => {
    setNoteDraft(order.merchantNote ?? '');
  }, [order.id, order.merchantNote]);

  // 操作日志：淘宝订单详情底部都有，谁改了什么要能追
  useEffect(() => {
    let cancelled = false;
    setLogsLoaded(false);
    void listOrderLogs(order.id)
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        if (!cancelled) setLogsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const saveNote = async () => {
    setNoteSaving(true);
    try {
      await setOrderNote(order.id, noteDraft);
      flash('备注已保存');
      onUpdated();
    } catch (err) {
      flash(err instanceof Error ? err.message : '备注保存失败');
    } finally {
      setNoteSaving(false);
    }
  };

  const loadShipContext = async () => {
    // 任一接口不可用时退回「无待发货」，不阻断页面其它操作。
    const [p, f, l] = await Promise.all([
      getFulfillmentPlan(order.id).catch(() => [] as FulfillmentPlanView[]),
      listOrderFulfillments(order.id).catch(() => [] as OrderFulfillmentView[]),
      listStockLocations().catch(() => [] as StockLocationView[]),
    ]);
    setPlans(p);
    setFulfillments(f);
    setLocations(l);
    setPlanLoaded(true);
  };

  useEffect(() => {
    void loadShipContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在订单切换时重载
  }, [order.id]);

  const openShip = () => {
    setShowShip(true);
    setShipError(null);
    void loadShipContext();
  };

  const formFor = (locationId: string) => forms[locationId] ?? { carrier: '', tracking: '' };
  const setForm = (locationId: string, patch: Partial<{ carrier: string; tracking: string }>) => {
    setForms((prev) => ({
      ...prev,
      [locationId]: { ...(prev[locationId] ?? { carrier: '', tracking: '' }), ...patch },
    }));
  };

  const shipPlan = async (plan: FulfillmentPlanView) => {
    const form = formFor(plan.locationId);
    if (!form.carrier.trim() || !form.tracking.trim()) {
      setShipError(`请填写「${locationName(plan.locationId)}」的承运商与运单号`);
      return;
    }
    setPending(plan.locationId);
    setShipError(null);
    try {
      await shipOrder(order.id, form.carrier.trim(), form.tracking.trim(), {
        stockLocationId: plan.locationId,
        items: plan.items.map((i) => ({ order_line_item_id: i.lineId, quantity: i.quantity })),
      });
      await loadShipContext();
      flash(`已从${locationName(plan.locationId)}发货`);
      onUpdated();
    } catch (err) {
      setShipError(err instanceof Error ? err.message : '发货失败，请稍后重试');
    } finally {
      setPending(null);
    }
  };

  const planLines = (plan: FulfillmentPlanView) =>
    plan.items
      .map((i) => {
        const line = order.items.find((it) => it.id === i.lineId);
        return `${line?.title ?? i.lineId} × ${i.quantity}`;
      })
      .join('、');

  const doRefund = async () => {
    if (refundReason.trim().length < 2) {
      setRefundError('请填写退款原因（至少 2 个字），顾客会在店面看到');
      return;
    }
    if (refundInput.trim() !== idTail) {
      setRefundError(`请输入订单号后四位「${idTail}」以确认`);
      return;
    }
    try {
      await requestOrderRefund(order.id, refundReason.trim());
      setRefundOpen(false);
      setRefundInput('');
      setRefundReason('');
      setRefundError(null);
      // 不写「已退款」：钱还没动，要商家去退款管理审核通过才退
      flash('已提交退款申请，请到「退款管理」审核');
      onUpdated();
    } catch (err) {
      setRefundError(err instanceof Error ? err.message : '提交失败');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant={pay.variant}>{pay.label}</Badge>
          <Badge variant={ful.variant}>{ful.label}</Badge>
          {refundPending && <Badge variant="warning">退款审核中</Badge>}
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

      {/* 商家备注：淘宝订单详情里的固定一块，仅后台可见 */}
      <section aria-label="商家备注" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">商家备注</h3>
        <TextAreaField
          id="order-note"
          label="内部备注（顾客看不到）"
          placeholder="客户要求、特殊包装、售后约定……"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void saveNote()}
            disabled={noteSaving || noteDraft === (order.merchantNote ?? '')}
          >
            {noteSaving ? '保存中…' : '保存备注'}
          </Button>
          {order.merchantNote && noteDraft === order.merchantNote && (
            <span className="text-xs text-muted-foreground">已保存</span>
          )}
        </div>
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

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {canShip ? (
          <Button size="sm" onClick={() => void openShip()}>
            <Truck className="size-4" strokeWidth={2} aria-hidden="true" />
            发货
          </Button>
        ) : refundPending ? (
          <span className="self-center text-xs text-warning" role="status">
            退款审核中，暂停发货
          </span>
        ) : refunded ? (
          <span className="self-center text-xs text-muted-foreground" role="status">
            已退款
          </span>
        ) : (
          <span className="self-center text-xs text-muted-foreground" role="status">
            已全部发货
          </span>
        )}

        {/* 有退款在审时不再给「发起退款」：同订单只允许一条待处理申请 */}
        {order.paymentStatus === 'paid' && !refundPending && !refunded && (
          <Button size="sm" variant="destructive" onClick={() => setRefundOpen(true)}>
            <RotateCcw className="size-4" strokeWidth={2} aria-hidden="true" />
            发起退款
          </Button>
        )}

        {refundPending && (
          <span className="text-xs text-muted-foreground">
            是否退款请在「订单 → 退款管理」审核（同意后才打款）
          </span>
        )}
      </div>

      {showShip && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs leading-5 text-muted-foreground">
            按仓自动拆分，一仓一单；填好每个仓的运单号即可分别发货。
          </p>
          {plans.length === 0 && (
            <p className="text-sm text-muted-foreground">没有待发货的仓（可能已全部发完）。</p>
          )}
          {plans.map((plan) => {
            const form = formFor(plan.locationId);
            return (
              <div key={plan.locationId} className="rounded-md border border-border bg-card p-3">
                <p className="text-sm font-medium text-foreground">
                  {locationName(plan.locationId)} · {plan.totalQuantity} 件
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{planLines(plan)}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <TextField
                    id={`ship-carrier-${plan.locationId}`}
                    label="承运商"
                    required
                    value={form.carrier}
                    onChange={(e) => setForm(plan.locationId, { carrier: e.target.value })}
                    placeholder="如 顺丰国际"
                  />
                  <TextField
                    id={`ship-tracking-${plan.locationId}`}
                    label="运单号"
                    required
                    value={form.tracking}
                    onChange={(e) => setForm(plan.locationId, { tracking: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={pending === plan.locationId}
                  onClick={() => void shipPlan(plan)}
                >
                  {pending === plan.locationId ? '发货中…' : `从${locationName(plan.locationId)}发货`}
                </Button>
              </div>
            );
          })}
          {shipError && (
            <p className="text-xs text-destructive" role="alert">
              {shipError}
            </p>
          )}
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
            <DialogTitle>发起退款申请</DialogTitle>
          </DialogHeader>
          <p className="mb-3 text-sm text-muted-foreground">
            提交后订单进入「退款审核中」并暂停发货，需在「退款管理」审核通过才会打款
            {formatMoney(order.totalMinor, order.currency)} 给顾客。一期仅支持全额退款。
          </p>
          <div className="space-y-3">
            <TextAreaField
              id="refund-reason"
              label="退款原因（顾客可见）"
              required
              placeholder="如：商品缺货 / 与顾客协商一致"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
            />
            <TextField
              id="refund-confirm"
              label={`输入订单号后四位「${idTail}」以确认`}
              value={refundInput}
              onChange={(e) => setRefundInput(e.target.value)}
              error={refundError ?? undefined}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRefundOpen(false);
                setRefundInput('');
                setRefundReason('');
                setRefundError(null);
              }}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={doRefund}>
              提交申请
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 操作日志：谁在什么时候改了什么（数据来自审计流水，非前端拼装） */}
      <section aria-label="操作日志" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">操作日志</h3>
        {!logsLoaded ? (
          <p className="text-xs text-muted-foreground">正在读取…</p>
        ) : logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            暂无操作记录。演示模式下没有真实审计流水，接上后端后这里会显示发货、退款、备注等变更。
          </p>
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span className="text-sm text-foreground">{logLabel(log.action)}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {log.actor} · {formatLogTime(log.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** 审计动作名 → 人话。未知动作原样显示，不吞掉信息。 */
const LOG_LABELS: Record<string, string> = {
  'order.note.update': '修改商家备注',
  'order.cancel': '取消订单',
  'order.refund.create': '发起退款',
  'fulfillment.create': '创建发货单',
  'shipment.create': '填写运单发货',
  'product.update': '修改商品',
};

function logLabel(action: string): string {
  return LOG_LABELS[action] ?? action;
}

function formatLogTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
