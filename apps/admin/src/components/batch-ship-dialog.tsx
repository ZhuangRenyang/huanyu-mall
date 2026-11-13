import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Truck } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@mall/ui';
import { TextField } from './field';
import { getFulfillmentPlan, shipOrder, type FulfillmentPlanView } from '@/lib/admin-orders';
import type { AdminOrder } from '@/lib/admin-data';

/**
 * 批量发货（对齐淘宝「已卖出的宝贝 → 批量发货」）。
 *
 * 淘宝的批量发货是「选中多单 → 统一填快递 → 逐单出单号」。自建站没有电子面单，
 * 所以这里退一步：**物流公司可统一填，单号必须一单一个**（一个包裹一个号，
 * 双填同一个号会让两个顾客查同一个轨迹）。
 *
 * 三条纪律：
 * 1. 只对「待发货（paid）」的订单开放，且不选退款中的单 —— 货发了钱也退了是净亏；
 * 2. 跨仓订单不参与批量（一张发货单不跨仓，拆单要各自录号），标出来让商家单独处理；
 * 3. **逐单执行、逐单报结果**，不整批回滚 —— 已经提交给快递的单退不回来，
 *    假装「整批失败」会让商家重复发货。
 */
export function BatchShipDialog({
  open,
  orders,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  orders: AdminOrder[];
  onOpenChange: (next: boolean) => void;
  onDone: () => void;
}) {
  /** 每单的发货计划：null = 加载中，[] = 拿不到（不能批量发）。 */
  const [plans, setPlans] = useState<Record<string, FulfillmentPlanView[] | null>>({});
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 逐单结果：成功打勾，失败留原因（不整批回滚）。 */
  const [results, setResults] = useState<Record<string, { ok: boolean; message?: string }>>({});

  /*
   * 依赖用「id 串」而不是数组本体：父组件每次都传新数组，
   * 直接依赖 orders 会让 effect 每渲染一次就跑一遍（并且在里面 setState → 无限循环）。
   */
  const orderKey = orders.map((o) => o.id).join(',');

  // 打开时拉每单的发货计划：跨仓订单要提前标出来，别等提交才报错
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPlans({});
    setResults({});
    setTracking({});
    setError(null);
    void (async () => {
      const entries = await Promise.all(
        orders.map(async (o) => {
          try {
            const plan = await getFulfillmentPlan(o.id);
            return [o.id, plan] as const;
          } catch {
            return [o.id, [] as FulfillmentPlanView[]] as const;
          }
        }),
      );
      if (!cancelled) setPlans(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上面的 orderKey 说明
  }, [open, orderKey]);

  const rows = useMemo(
    () =>
      orders.map((o) => {
        const plan = plans[o.id];
        const multiLocation = (plan?.length ?? 0) > 1;
        const noPlan = plan !== undefined && plan !== null && plan.length === 0;
        const done = results[o.id];
        return { order: o, plan, multiLocation, noPlan, done };
      }),
    [orders, plans, results],
  );

  const shippable = rows.filter((r) => !r.multiLocation && !r.noPlan && !r.done?.ok && r.plan);
  const readyCount = shippable.filter((r) => (tracking[r.order.id] ?? '').trim().length > 0).length;

  const submit = async () => {
    if (!carrier.trim()) {
      setError('请填写物流公司');
      return;
    }
    setBusy(true);
    setError(null);
    // 逐单执行：一单失败不影响其他单（已交给快递的退不回来）
    for (const row of shippable) {
      const number = (tracking[row.order.id] ?? '').trim();
      if (!number) continue;
      const plan = row.plan!;
      try {
        await shipOrder(row.order.id, carrier.trim(), number, {
          stockLocationId: plan[0]?.locationId,
          items: plan[0]?.items.map((i) => ({
            order_line_item_id: i.lineId,
            quantity: i.quantity,
          })),
        });
        setResults((prev) => ({ ...prev, [row.order.id]: { ok: true } }));
      } catch (err) {
        // 失败原因原样回显：物流公司名对不上、状态已变、库存预留被释放，处理方式都不同
        setResults((prev) => ({
          ...prev,
          [row.order.id]: { ok: false, message: err instanceof Error ? err.message : '发货失败' },
        }));
      }
    }
    setBusy(false);
    onDone();
  };

  const doneCount = Object.values(results).filter((r) => r.ok).length;
  const allDone = shippable.length > 0 && shippable.every((r) => results[r.order.id]?.ok);

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量发货（{orders.length} 单）</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            物流公司可统一填写，<strong className="font-medium text-foreground">单号必须一单一个</strong>
            （一个包裹一个号）。跨仓订单不能批量子，请单独进入订单详情发货。
          </p>

          <TextField
            id="batch-carrier"
            label="物流公司"
            placeholder="如：顺丰 / 中通 / DHL"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
          />

          <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">订单</th>
                  <th scope="col" className="px-3 py-2 font-medium">物流单号</th>
                  <th scope="col" className="px-3 py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const result = row.done;
                  const disabled = row.multiLocation || row.noPlan || result?.ok;
                  return (
                    <tr key={row.order.id}>
                      <td className="px-3 py-2">
                        <span className="block font-mono text-xs text-foreground">{row.order.id}</span>
                        <span className="block text-xs text-muted-foreground">
                          {row.order.customerName}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`订单 ${row.order.id} 的物流单号`}
                          value={tracking[row.order.id] ?? ''}
                          disabled={disabled || busy}
                          onChange={(e) =>
                            setTracking((prev) => ({ ...prev, [row.order.id]: e.target.value }))
                          }
                          placeholder={row.multiLocation ? '跨仓，请单独发货' : '快递单号'}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring disabled:bg-muted disabled:text-muted-foreground"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {result?.ok ? (
                          <Badge variant="success">
                            <Check className="mr-1 size-3" strokeWidth={2} aria-hidden="true" />
                            已发货
                          </Badge>
                        ) : row.multiLocation ? (
                          <Badge variant="warning">
                            <AlertTriangle className="mr-1 size-3" strokeWidth={2} aria-hidden="true" />
                            跨仓
                          </Badge>
                        ) : row.noPlan ? (
                          <span className="text-xs text-muted-foreground">无发货计划</span>
                        ) : result ? (
                          <span className="block max-w-40 text-xs text-destructive" role="alert">
                            {result.message ?? '发货失败'}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">待填单号</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {doneCount > 0 && (
            <p className="text-sm text-success" role="status">
              <Truck className="mr-1 inline size-4" strokeWidth={2} aria-hidden="true" />
              已发货 {doneCount} 单{allDone ? '，全部完成' : '，其余请处理上面标红的原因'}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {doneCount > 0 ? '关闭' : '取消'}
          </Button>
          <Button disabled={busy || readyCount === 0} onClick={() => void submit()}>
            {busy ? '发货中…' : `确认发货（${readyCount}）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
