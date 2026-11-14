import { useCallback, useEffect, useState } from 'react';
import { Check, Share2, UserPlus } from 'lucide-react';
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
import {
  listAffiliates,
  listCommissions,
  registerAffiliate,
  setAffiliateStatus,
  settleCommission,
  type AffiliateView,
  type CommissionStatus,
  type CommissionView,
} from '@/lib/admin-affiliates';
import { listCustomers } from '@/lib/admin-customers';

/**
 * 分销（ADR-101，对齐 CRMEB「营销 → 分销」）。
 *
 * 推广员是**顾客**：商家给他一个推广码，带码成交的订单完成后自动记一笔佣金。
 *
 * 界面上必须说清的一条：**系统不转账**。商家线下（微信/支付宝/银行卡）打款给
 * 推广员之后，回这里点「标记已结算」——这是账本，不是提现通道。
 */
const COMMISSION_LABEL: Record<CommissionStatus, { label: string; variant: 'warning' | 'success' | 'neutral' }> = {
  pending: { label: '待结算', variant: 'warning' },
  settled: { label: '已结算', variant: 'success' },
  canceled: { label: '已作废', variant: 'neutral' },
};

export function AffiliatesPage() {
  const [tab, setTab] = useState<'affiliates' | 'commissions'>('affiliates');
  const [affiliates, setAffiliates] = useState<AffiliateView[]>([]);
  const [commissions, setCommissions] = useState<CommissionView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [a, c] = await Promise.all([listAffiliates(), listCommissions()]);
      setAffiliates(a);
      setCommissions(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载分销数据失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (a: AffiliateView) => {
    setBusyId(a.id);
    setError(null);
    try {
      await setAffiliateStatus(a.id, a.status === 'active' ? 'disabled' : 'active');
      await load();
      setFlash(a.status === 'active' ? '已停用，推广码立即失效' : '已恢复');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const settle = async (c: CommissionView) => {
    setBusyId(c.id);
    setError(null);
    try {
      await settleCommission(c.id);
      await load();
      setFlash('已标记结算（系统不转账，请确认线下已打款）');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const codeOf = (affiliateId: string): string =>
    affiliates.find((a) => a.id === affiliateId)?.code ?? affiliateId;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">分销</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            把客户设为推广员，带码成交的订单完成后自动记佣金。
            <strong className="font-medium text-foreground">
              系统不发起转账：线下打款后再点「标记结算」
            </strong>
            。
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <UserPlus className="size-4" strokeWidth={2} aria-hidden="true" />
          添加推广员
        </Button>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="分销视图">
        {(
          [
            { value: 'affiliates' as const, label: `推广员 ${affiliates.length}` },
            { value: 'commissions' as const, label: `佣金 ${commissions.length}` },
          ]
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              'h-8 rounded-md px-3 text-sm transition-colors duration-150',
              tab === t.value
                ? 'bg-primary-subtle font-medium text-primary-subtle-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t.label}
          </button>
        ))}
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

      {tab === 'affiliates' ? (
        affiliates.length === 0 ? (
          <EmptyState
            icon={Share2}
            title="还没有推广员"
            description="添加推广员后，把「推广码」发给对方，他用自己的链接带客下单"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">客户</th>
                  <th scope="col" className="px-4 py-3 font-medium">推广码</th>
                  <th scope="col" className="px-4 py-3 font-medium">佣金比例</th>
                  <th scope="col" className="px-4 py-3 font-medium">状态</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {affiliates.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span className="block font-mono text-xs text-foreground">{a.customerId}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-foreground">{a.code}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        链接：?ref={a.code}
                      </span>
                    </td>
                    <td className="tabular px-4 py-3">
                      {(a.commissionBps / 100).toFixed(2).replace(/\.?0+$/, '')}%
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={a.status === 'active' ? 'success' : 'neutral'}>
                        {a.status === 'active' ? '生效中' : '已停用'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" disabled={busyId === a.id} onClick={() => void toggle(a)}>
                        {a.status === 'active' ? '停用' : '恢复'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : commissions.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="还没有佣金"
          description="带推广码的订单完成（确认收货）后，这里会出现待结算佣金"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">订单</th>
                <th scope="col" className="px-4 py-3 font-medium">推广员</th>
                <th scope="col" className="px-4 py-3 font-medium">订单金额</th>
                <th scope="col" className="px-4 py-3 font-medium">佣金</th>
                <th scope="col" className="px-4 py-3 font-medium">状态</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {commissions.map((c) => {
                const meta = COMMISSION_LABEL[c.status];
                return (
                  <tr key={c.id} className={cn('hover:bg-muted/50', c.status === 'pending' && 'bg-warning-subtle/40')}>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{c.orderId}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{codeOf(c.affiliateId)}</td>
                    <td className="tabular px-4 py-3">{formatMoney(c.orderTotalMinor, 'CNY')}</td>
                    <td className="tabular px-4 py-3 font-medium">{formatMoney(c.commissionMinor, 'CNY')}</td>
                    <td className="px-4 py-3">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {c.canceledReason && (
                        <span className="mt-1 block text-xs text-muted-foreground">{c.canceledReason}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.status === 'pending' ? (
                        <Button size="sm" disabled={busyId === c.id} onClick={() => void settle(c)}>
                          <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                          标记已结算
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {c.status === 'settled' ? '已结清' : '不计佣'}
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

      <CreateAffiliateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          setFlash('已添加推广员，把推广码发给对方即可');
          await load();
        }}
        onError={setError}
      />
    </div>
  );
}

function CreateAffiliateDialog({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [customers, setCustomers] = useState<Array<{ id: string; email: string }>>([]);
  const [customerId, setCustomerId] = useState('');
  const [code, setCode] = useState('');
  const [rate, setRate] = useState('5');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listCustomers({ limit: 100 }).then((res) => {
      setCustomers(res.items.map((c) => ({ id: c.id, email: c.email })));
      setCustomerId((prev) => prev || res.items[0]?.id || '');
    });
  }, [open]);

  const submit = async () => {
    if (!customerId) return onError('请选择客户');
    const pct = Number(rate);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 30) return onError('佣金比例需在 0.01%–30% 之间');
    setBusy(true);
    onError('');
    try {
      await registerAffiliate({
        customerId,
        code: code.trim() || undefined,
        // 百分比 → 万分比
        commissionBps: Math.round(pct * 100),
      });
      setCode('');
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加推广员</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">
            客户
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-2 py-2 text-sm text-foreground"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.email}（{c.id}）
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            推广码（选填，不填自动生成）
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="如 HUANYU01"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            佣金比例（%）
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="5"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            佣金按订单**实付**计算，订单完成（确认收货）时记账；退款自动作废未结算的佣金。
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? '添加中…' : '确认添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
