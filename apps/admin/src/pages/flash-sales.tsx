import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Plus, Square, Trash2, Zap } from 'lucide-react';
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
  createFlashSale,
  listFlashSales,
  setFlashSaleStatus,
  type CreateFlashSaleItemInput,
  type FlashSaleStatus,
  type FlashSaleView,
} from '@/lib/admin-flash-sales';
import { listProducts } from '@/lib/admin-catalog';
import { yuanToMinor } from '@/lib/admin-shipping';
import type { ProductDraft } from '@/lib/admin-data';

/**
 * 限时秒杀（ADR-099，对齐淘宝「营销 → 限时秒杀」）。
 *
 * 与普通促销只差两条：**限时**、**限量**。
 * 限量是活动自己的库存，卖完即止；仓库库存是另一道闸，两个都要过。
 *
 * 界面上必须说清的三件事：
 *   1. 创建后是**草稿**，要手动上架才生效（价格填错就开卖 = 资损）；
 *   2. 活动库存是「本次活动最多卖多少」，不是改仓库库存；
 *   3. 已售数量不可改，结束活动也不清空。
 */

const STATUS_META: Record<FlashSaleStatus, { label: string; variant: 'neutral' | 'success' | 'warning' }> = {
  draft: { label: '草稿', variant: 'neutral' },
  active: { label: '进行中', variant: 'success' },
  ended: { label: '已结束', variant: 'warning' },
};

const TABS: Array<{ value: FlashSaleStatus | 'all'; label: string }> = [
  { value: 'active', label: '进行中' },
  { value: 'draft', label: '草稿' },
  { value: 'ended', label: '已结束' },
  { value: 'all', label: '全部' },
];

/** `<input type="datetime-local">` 的值 ↔ ISO 字符串。 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FlashSalesPage() {
  const [items, setItems] = useState<FlashSaleView[]>([]);
  const [status, setStatus] = useState<FlashSaleStatus | 'all'>('active');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(
        await listFlashSales({
          ...(status === 'all' ? {} : { status }),
          limit: 50,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载秒杀活动失败');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (sale: FlashSaleView) => {
    setBusyId(sale.id);
    setError(null);
    try {
      const next = sale.status === 'active' ? 'ended' : 'active';
      await setFlashSaleStatus(sale.id, next);
      setFlash(next === 'active' ? '已上架，活动到点自动生效' : '已结束，不再享受秒杀价');
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
          <h1 className="text-lg font-semibold text-foreground">限时秒杀</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            活动商品按秒杀价卖，<strong className="font-medium text-foreground">限时限量</strong>
            ：卖完即止，仓库库存另算。创建后是草稿，上架才生效。
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          新建活动
        </Button>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="秒杀状态筛选">
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
          icon={Zap}
          title={status === 'active' ? '没有进行中的秒杀' : '还没有秒杀活动'}
          description="新建活动后先核对价格与库存，再点「上架」开卖"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((sale) => {
            const meta = STATUS_META[sale.status];
            return (
              <li key={sale.id} className="rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {sale.name}
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {toLocalInput(sale.startsAt).replace('T', ' ')} 至{' '}
                      {toLocalInput(sale.endsAt).replace('T', ' ')} · {sale.items.length} 个商品
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {sale.status !== 'ended' && (
                      <Button
                        size="sm"
                        variant={sale.status === 'active' ? 'ghost' : 'primary'}
                        disabled={busyId === sale.id}
                        onClick={() => void toggle(sale)}
                      >
                        {sale.status === 'active' ? (
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
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {sale.items.map((it) => (
                    <li key={it.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate text-foreground">{it.title}</span>
                      <span className="tabular text-muted-foreground line-through">
                        {formatMoney(it.originalPriceMinor, 'CNY')}
                      </span>
                      <span className="tabular font-medium text-accent-orange">
                        {formatMoney(it.flashPriceMinor, 'CNY')}
                      </span>
                      <span className="tabular text-xs text-muted-foreground">
                        已售 {it.sold}/{it.stock}
                      </span>
                    </li>
                  ))}
                  {sale.items.length === 0 && (
                    <li className="px-4 py-2.5 text-xs text-muted-foreground">这场活动还没有商品</li>
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <CreateFlashSaleDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          setFlash('已创建草稿，核对价格与库存后点「上架」');
          await load();
        }}
        onError={setError}
      />
    </div>
  );
}

/** 新建活动：名称 + 时间窗 + 商品清单（一次配完，少一次往返）。 */
function CreateFlashSaleDialog({
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
  const [flashPrice, setFlashPrice] = useState('');
  const [stock, setStock] = useState('');
  const [rows, setRows] = useState<CreateFlashSaleItemInput[]>([]);
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

  const addRow = () => {
    const variant = product?.variants.find((v) => v.id === variantId);
    if (!product || !variant) {
      onError('请选择商品与规格');
      return;
    }
    if (rows.some((r) => r.variantId === variant.id)) {
      onError('这个规格已经加过了');
      return;
    }
    const priceMinor = yuanToMinor(flashPrice);
    if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
      onError('请填写秒杀价');
      return;
    }
    if (priceMinor >= variant.priceMinor) {
      onError('秒杀价必须低于原价');
      return;
    }
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum <= 0) {
      onError('活动库存必须是正整数');
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        variantId: variant.id,
        title: `${product.title} · ${variant.title}`,
        originalPriceMinor: variant.priceMinor,
        flashPriceMinor: priceMinor,
        stock: stockNum,
      },
    ]);
    setFlashPrice('');
    setStock('');
    onError('');
  };

  const submit = async () => {
    if (name.trim() === '') {
      onError('请填写活动名称');
      return;
    }
    if (rows.length === 0) {
      onError('请至少添加一个秒杀商品');
      return;
    }
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!(end.getTime() > start.getTime())) {
      onError('结束时间必须晚于开始时间');
      return;
    }
    setBusy(true);
    onError('');
    try {
      await createFlashSale({
        name: name.trim(),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        items: rows,
      });
      setName('');
      setRows([]);
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建秒杀活动</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">
            活动名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：周末限时秒杀"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
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

          {/* 商品编辑器 */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-foreground">秒杀商品</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted-foreground">
                商品
                <select
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setVariantId(
                      products.find((p) => p.id === e.target.value)?.variants?.[0]?.id ?? '',
                    );
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
                秒杀价（元）
                <input
                  value={flashPrice}
                  onChange={(e) => setFlashPrice(e.target.value)}
                  placeholder="如 69.90"
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                活动库存（件）
                <input
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  placeholder="如 20"
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
            <Button size="sm" variant="secondary" onClick={addRow}>
              加入活动
            </Button>

            {rows.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {rows.map((r) => (
                  <li key={r.variantId} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">{r.title}</span>
                    <span className="tabular text-xs text-muted-foreground line-through">
                      {formatMoney(r.originalPriceMinor, 'CNY')}
                    </span>
                    <span className="tabular text-xs font-medium text-accent-orange">
                      {formatMoney(r.flashPriceMinor, 'CNY')}
                    </span>
                    <span className="tabular text-xs text-muted-foreground">× {r.stock}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${r.title}`}
                      onClick={() => setRows((prev) => prev.filter((x) => x.variantId !== r.variantId))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              活动库存是「本次活动最多卖多少」，不改仓库库存；卖完后按原价继续销售。
            </p>
          </div>
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
