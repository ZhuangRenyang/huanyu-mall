import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Plus, Power, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  formatMoney,
} from '@mall/ui';
import { SelectField, TextField } from './field';
import { ListPager, ListSearch } from './list-toolbar';
import {
  adjustGiftCard,
  createGiftCard,
  getGiftCard,
  giftCardEventLabel,
  listGiftCardEvents,
  listGiftCards,
  setGiftCardStatus,
  updateGiftCard,
} from '@/lib/admin-api';
import type { GiftCardEventView, GiftCardInput, GiftCardView } from '@/lib/admin-api';

const yuanToMinor = (yuan: string) => Math.round(Number(yuan) * 100) || 0;
const minorToYuan = (minor: number) => (minor / 100).toFixed(2);

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function GiftCardTab() {
  const [items, setItems] = useState<GiftCardView[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailFor, setDetailFor] = useState<GiftCardView | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setApplied(query.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listGiftCards({ q: applied || undefined, limit: 20, offset: page * 20 });
      setItems(res.items);
      setTotal(res.total);
      setHasMore(res.hasMore);
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleStatus = async (g: GiftCardView) => {
    await setGiftCardStatus(g.id, !g.isActive);
    await refresh();
  };
  const openDetail = async (g: GiftCardView) => {
    const fresh = await getGiftCard(g.id);
    if (fresh) setDetailFor(fresh);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          礼品卡：卡码由系统生成，余额变动走「调账」留痕，下单抵扣后自动扣减。
        </p>
        <div className="flex items-center gap-2">
          <ListSearch value={query} onChange={setQuery} placeholder="搜索卡号" />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            新建礼品卡
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">卡码</th>
              <th className="px-4 py-3 font-medium">余额</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">有效期 / 绑定</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((g) => (
              <tr key={g.id} className="transition-colors duration-150 hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs text-foreground">{g.code}</td>
                <td className="tabular px-4 py-3">{formatMoney(g.currentBalance, g.currency)}</td>
                <td className="px-4 py-3">
                  {g.isActive ? <Badge variant="success">可用</Badge> : <Badge variant="neutral">已停用</Badge>}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {g.expiresAt ? `至 ${g.expiresAt.slice(0, 10)}` : '长期有效'}
                  {g.assignedTo ? ` · 绑定 ${g.assignedTo}` : ''}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <IconButton aria-label={`查看并调账 ${g.code}`} size="sm" onClick={() => void openDetail(g)}>
                      <Wallet className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-label={g.isActive ? `停用 ${g.code}` : `启用 ${g.code}`}
                      size="sm"
                      onClick={() => void toggleStatus(g)}
                    >
                      <Power className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  还没有礼品卡，点「新建礼品卡」创建第一张
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ListPager
        page={page}
        hasMore={hasMore}
        total={total}
        loading={loading}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />

      <GiftCardCreate open={createOpen} onClose={() => setCreateOpen(false)} onSaved={refresh} />
      <GiftCardDetail card={detailFor} onClose={() => setDetailFor(null)} onChanged={refresh} />
    </div>
  );
}

function GiftCardCreate({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [balanceYuan, setBalanceYuan] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBalanceYuan('');
    setExpiresAt('');
    setAssignedTo('');
    setError(null);
    setSubmitting(false);
  }, [open]);

  const submit = async () => {
    setError(null);
    const balance = yuanToMinor(balanceYuan);
    if (balance <= 0) {
      setError('初始余额必须大于 0');
      return;
    }
    const input: GiftCardInput = {
      currency: 'CNY',
      initialBalance: balance,
      expiresAt: fromLocalInput(expiresAt),
      assignedTo: assignedTo.trim() || null,
    };
    setSubmitting(true);
    try {
      await createGiftCard(input);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建礼品卡</DialogTitle>
          <DialogDescription>卡码由系统自动生成（GC- 开头），余额以元为单位输入。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <TextField
            id="gc-balance"
            label="初始余额（元）"
            type="number"
            min="0"
            step="0.01"
            required
            value={balanceYuan}
            onChange={(e) => setBalanceYuan(e.target.value)}
            className="tabular"
          />
          <TextField
            id="gc-expires"
            label="有效期至（选填）"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <TextField
            id="gc-assigned"
            label="绑定客户（选填）"
            placeholder="客户邮箱或昵称"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
          />
          {error && (
            <p className="rounded-md border border-destructive bg-destructive-subtle px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void submit()} loading={submitting}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GiftCardDetail({
  card,
  onClose,
  onChanged,
}: {
  card: GiftCardView | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState<GiftCardView | null>(null);
  const [events, setEvents] = useState<GiftCardEventView[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [deltaYuan, setDeltaYuan] = useState('');
  const [deltaPositive, setDeltaPositive] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!card) return;
    setCurrent(card);
    setExpiresAt(toLocalInput(card.expiresAt));
    setAssignedTo(card.assignedTo ?? '');
    setDeltaYuan('');
    setDeltaPositive(true);
    setReason('');
    setError(null);
    void (async () => {
      try {
        setEvents(await listGiftCardEvents(card.id));
      } catch {
        setEvents([]);
      }
    })();
  }, [card]);

  if (!card || !current) return null;

  const reloadEvents = async () => {
    try {
      setEvents(await listGiftCardEvents(card.id));
    } catch {
      /* ignore */
    }
  };

  const saveInfo = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateGiftCard(card.id, {
        expiresAt: fromLocalInput(expiresAt),
        assignedTo: assignedTo.trim() || null,
      });
      await onChanged();
      const fresh = await getGiftCard(card.id);
      if (fresh) setCurrent(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const adjust = async () => {
    setBusy(true);
    setError(null);
    const amount = yuanToMinor(deltaYuan);
    if (amount <= 0) {
      setError('调账金额必须大于 0');
      setBusy(false);
      return;
    }
    try {
      const updated = await adjustGiftCard(card.id, deltaPositive ? amount : -amount, reason.trim());
      if (!updated) {
        setError('调账失败：余额不足或卡片状态异常');
      } else {
        setCurrent(updated);
        setDeltaYuan('');
        setReason('');
        await onChanged();
        await reloadEvents();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '调账失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <CreditCard className="size-5" strokeWidth={2} aria-hidden="true" />
              礼品卡 <span className="font-mono text-sm text-muted-foreground">{current.code}</span>
            </span>
          </DialogTitle>
          <DialogDescription>
            当前余额 <span className="tabular font-medium text-foreground">{formatMoney(current.currentBalance, current.currency)}</span>
            （初始 {formatMoney(current.initialBalance, current.currency)}）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
            <TextField
              id="gc-d-expires"
              label="有效期至（选填）"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <TextField
              id="gc-d-assigned"
              label="绑定客户（选填）"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={() => void saveInfo()} loading={busy}>
              保存信息
            </Button>
          </section>

          <section className="space-y-3 rounded-lg border border-border p-3">
            <h3 className="text-sm font-semibold text-foreground">手动调账</h3>
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <SelectField
                id="gc-d-dir"
                label="方向"
                value={deltaPositive ? 'add' : 'sub'}
                onChange={(e) => setDeltaPositive(e.target.value === 'add')}
                options={[
                  { value: 'add', label: '加余额' },
                  { value: 'sub', label: '减余额' },
                ]}
              />
              <TextField
                id="gc-d-delta"
                label="金额（元）"
                type="number"
                min="0"
                step="0.01"
                value={deltaYuan}
                onChange={(e) => setDeltaYuan(e.target.value)}
                className="tabular"
              />
            </div>
            <TextField
              id="gc-d-reason"
              label="调账原因（选填）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button size="sm" onClick={() => void adjust()} loading={busy}>
              确认调账
            </Button>
          </section>

          {error && (
            <p className="rounded-md border border-destructive bg-destructive-subtle px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-foreground">流水账本</h3>
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 text-foreground">{giftCardEventLabel(e.type)}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {e.amount > 0 ? '+' : ''}
                    {formatMoney(e.amount, card.currency)}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.createdAt.slice(0, 16).replace('T', ' ')}</span>
                </li>
              ))}
              {events.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">暂无流水</li>
              )}
            </ul>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
