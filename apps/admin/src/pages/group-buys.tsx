import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Plus, Square, Users } from 'lucide-react';
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
  createGroupBuy,
  listGroupBuys,
  setGroupBuyStatus,
  type GroupBuyStatus,
  type GroupBuyView,
} from '@/lib/admin-group-buys';
import { listProducts } from '@/lib/admin-catalog';
import { yuanToMinor } from '@/lib/admin-shipping';
import type { ProductDraft } from '@/lib/admin-data';

/**
 * 拼团（ADR-100，对齐 CRMEB「营销 → 拼团」）。
 *
 * 本项目的拼团是**参团免费、成团领券**：参团不收钱、不建订单、不占库存；
 * 人齐后每个成员领一张拼团专享券，拿券正常下单。
 * 所以未成团时**没有任何退款动作**（没收过钱），与「退款只走人工审核」一致。
 */

const STATUS_META: Record<GroupBuyStatus, { label: string; variant: 'neutral' | 'success' | 'warning' }> = {
  draft: { label: '草稿', variant: 'neutral' },
  active: { label: '进行中', variant: 'success' },
  ended: { label: '已结束', variant: 'warning' },
};

const TABS: Array<{ value: GroupBuyStatus | 'all'; label: string }> = [
  { value: 'active', label: '进行中' },
  { value: 'draft', label: '草稿' },
  { value: 'ended', label: '已结束' },
  { value: 'all', label: '全部' },
];

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function GroupBuysPage() {
  const [items, setItems] = useState<GroupBuyView[]>([]);
  const [status, setStatus] = useState<GroupBuyStatus | 'all'>('active');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listGroupBuys({ ...(status === 'all' ? {} : { status }), limit: 50 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载拼团活动失败');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (a: GroupBuyView) => {
    setBusyId(a.id);
    setError(null);
    try {
      const next = a.status === 'active' ? 'ended' : 'active';
      await setGroupBuyStatus(a.id, next);
      setFlash(next === 'active' ? '已上架，顾客可以参团了' : '已结束，进行中的团到点自动失效');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">拼团</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            参团免费、成团领券：参团不收款、不占库存；
            <strong className="font-medium text-foreground">人齐后成员领拼团专享券</strong>
            ，拿券正常下单。
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          新建活动
        </Button>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="拼团状态筛选">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => setStatus(tab.value)}
            className={cn(
              'h-8 rounded-md px-3 text-sm transition-colors duration-150',
              status === tab.value
                ? 'bg-primary-subtle font-medium text-primary-subtle-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {tab.label}
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

      {items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={status === 'active' ? '没有进行中的拼团' : '还没有拼团活动'}
          description="新建活动后先核对人数与价格，再点「上架」"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const meta = STATUS_META[a.status];
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {a.name}
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="text-xs font-normal text-muted-foreground">
                      {a.teamSize} 人成团
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {a.title} · {toLocalInput(a.startsAt).replace('T', ' ')} 至{' '}
                    {toLocalInput(a.endsAt).replace('T', ' ')}
                  </p>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="tabular text-sm font-medium text-accent-orange">
                    {formatMoney(a.groupPriceMinor, 'CNY')}
                  </span>
                  <span className="tabular text-xs text-muted-foreground line-through">
                    {formatMoney(a.originalPriceMinor, 'CNY')}
                  </span>
                </div>
                {a.status !== 'ended' && (
                  <Button
                    size="sm"
                    variant={a.status === 'active' ? 'ghost' : 'primary'}
                    disabled={busyId === a.id}
                    onClick={() => void toggle(a)}
                  >
                    {a.status === 'active' ? (
                      <>
                        <Square className="size-3.5" strokeWidth={2} aria-hidden="true" />
                        结束活动
                      </>
                    ) : (
                      <>
                        <Play className="size-3.5" strokeWidth={2} aria-hidden="true" />
                        上架
                      </>
                    )}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CreateGroupBuyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          setFlash('已创建草稿，核对人数与价格后点「上架」');
          await load();
        }}
        onError={setError}
      />
    </div>
  );
}

function CreateGroupBuyDialog({
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
  const [products, setProducts] = useState<ProductDraft[]>([]);
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState(toLocalInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(
    toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString()),
  );
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [groupPrice, setGroupPrice] = useState('');
  const [teamSize, setTeamSize] = useState('2');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listProducts({ limit: 100 }).then((res) => {
      setProducts(res.items);
      const first = res.items[0];
      setProductId((prev) => prev || first?.id || '');
      setVariantId((prev) => prev || first?.variants?.[0]?.id || '');
    });
  }, [open]);

  const product = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  const submit = async () => {
    const variant = product?.variants.find((v) => v.id === variantId);
    if (name.trim() === '') return onError('请填写活动名称');
    if (!product || !variant) return onError('请选择商品与规格');
    const price = yuanToMinor(groupPrice);
    if (!Number.isFinite(price) || price <= 0) return onError('请填写拼团价');
    if (price >= variant.priceMinor) return onError('拼团价必须低于原价');
    const size = Number(teamSize);
    if (!Number.isInteger(size) || size < 2 || size > 10) return onError('成团人数需在 2–10 人之间');
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!(end.getTime() > start.getTime())) return onError('结束时间必须晚于开始时间');

    setBusy(true);
    onError('');
    try {
      await createGroupBuy({
        name: name.trim(),
        variantId: variant.id,
        productId: product.id,
        title: `${product.title} · ${variant.title}`,
        originalPriceMinor: variant.priceMinor,
        groupPriceMinor: price,
        teamSize: size,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });
      setName('');
      setGroupPrice('');
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>新建拼团活动</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">
            活动名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：两人成团立减 30"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted-foreground">
              商品
              <select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setVariantId(products.find((p) => p.id === e.target.value)?.variants?.[0]?.id ?? '');
                }}
                className="mt-1 w-full rounded-md border border-border px-2 py-2 text-sm text-foreground"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              规格
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-2 py-2 text-sm text-foreground"
              >
                {(product?.variants ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}（{formatMoney(v.priceMinor, 'CNY')}）
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              拼团价（元）
              <input
                value={groupPrice}
                onChange={(e) => setGroupPrice(e.target.value)}
                placeholder="如 69.90"
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              成团人数（含团长）
              <input
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
                placeholder="2"
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              开始时间
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              结束时间
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>

          <p className="text-xs text-muted-foreground">
            创建时会自动生成一张「拼团专享券」（面额 = 原价 − 拼团价，仅成团成员可领）。
            参团不收款，成团后成员领券下单。
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建（草稿）'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
