import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Power, TicketPercent, Trash2 } from 'lucide-react';
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
  Textarea,
  formatMoney,
} from '@mall/ui';
import { SelectField, TextField } from './field';
import { ListPager, ListSearch } from './list-toolbar';
import {
  addVoucherCodes,
  createVoucher,
  deleteVoucherCode,
  getVoucher,
  listVouchers,
  setVoucherCodeStatus,
  setVoucherStatus,
  updateVoucher,
} from '@/lib/admin-api';
import type { VoucherCodeView, VoucherDetailView, VoucherInput, VoucherView } from '@/lib/admin-api';
import { listCategories, type CategoryView } from '@/lib/admin-categories';
import { listProducts } from '@/lib/admin-api';
import type { ProductDraft } from '@/lib/admin-data';

/* ------------------------------------------------------------------ *
 * 输入换算：金额一律 minor unit（分）；百分比为万分比 bps（2000=20%）。
 * ------------------------------------------------------------------ */

const yuanToMinor = (yuan: string) => Math.round(Number(yuan) * 100) || 0;
const minorToYuan = (minor: number) => (minor / 100).toFixed(2);
const percentToBps = (percent: string) => Math.round(Number(percent) * 100) || 0;
const bpsToPercent = (bps: number) => (bps / 100).toString();

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

const TYPE_LABEL: Record<VoucherView['type'], string> = {
  entire_order: '整单',
  shipping: '运费',
  specific_product: '指定商品',
};

function discountText(v: Pick<VoucherView, 'discountType' | 'discountValue'>): string {
  // 百分比是「减去多少」：2000 bps = 减 20%。写成「打 20 折」会误导（中文 8 折才是付 80%）。
  return v.discountType === 'fixed'
    ? `减 ${formatMoney(v.discountValue, 'CNY')}`
    : `减 ${bpsToPercent(v.discountValue)}%`;
}

/* ------------------------------------------------------------------ *
 * 优惠券 tab
 * ------------------------------------------------------------------ */

export function VoucherTab() {
  const [items, setItems] = useState<VoucherView[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  /** 搜索：输入即请求会每敲一个字打一次接口，300ms 防抖。 */
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<VoucherView | null>(null);
  const [codesFor, setCodesFor] = useState<VoucherDetailView | null>(null);

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
      const res = await listVouchers({ q: applied || undefined, limit: 20, offset: page * 20 });
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

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (v: VoucherView) => {
    setEditing(v);
    setEditorOpen(true);
  };
  const openCodes = async (v: VoucherView) => {
    const detail = await getVoucher(v.id);
    if (detail) setCodesFor(detail);
  };
  const toggleStatus = async (v: VoucherView) => {
    await setVoucherStatus(v.id, v.status !== 'active');
    await refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          优惠券：满减 / 折扣，支持一券多码、限额与有效期。停用后立即不参与计算。
        </p>
        <div className="flex items-center gap-2">
          <ListSearch value={query} onChange={setQuery} placeholder="搜索券名称" />
          <Button onClick={openCreate}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            新建优惠券
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 font-medium">优惠</th>
              <th className="px-4 py-3 font-medium">门槛 / 限额</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((v) => (
              <tr key={v.id} className="transition-colors duration-150 hover:bg-muted/50">
                <td className="px-4 py-3 font-medium text-foreground">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {v.name}
                    {/* 公开可领 = 商品页会出现「领取」按钮，列表里要一眼能认出来 */}
                    {v.isPublic && <Badge variant="brand">店铺券</Badge>}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{TYPE_LABEL[v.type]}</td>
                <td className="tabular px-4 py-3">{discountText(v)}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {v.minSpent != null ? `满 ${formatMoney(v.minSpent, 'CNY')}` : '无门槛'}
                  {v.usageLimit != null ? ` · 限 ${v.usageLimit} 次` : ''}
                </td>
                <td className="px-4 py-3">
                  {v.status === 'active' ? <Badge variant="success">启用中</Badge> : <Badge variant="neutral">已停用</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <IconButton aria-label={`管理 ${v.name} 的券码`} size="sm" onClick={() => void openCodes(v)}>
                      <KeyRound className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-label={v.status === 'active' ? `停用 ${v.name}` : `启用 ${v.name}`}
                      size="sm"
                      onClick={() => void toggleStatus(v)}
                    >
                      <Power className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                    <IconButton aria-label={`编辑 ${v.name}`} size="sm" onClick={() => openEdit(v)}>
                      <TicketPercent className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  还没有优惠券，点「新建优惠券」创建第一张
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

      <VoucherEditor
        open={editorOpen}
        voucher={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={async () => {
          setEditorOpen(false);
          await refresh();
        }}
      />

      <VoucherCodesDialog detail={codesFor} onClose={() => setCodesFor(null)} onChanged={refresh} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 创建 / 编辑
 * ------------------------------------------------------------------ */

function VoucherEditor({
  open,
  voucher,
  onClose,
  onSaved,
}: {
  open: boolean;
  voucher: VoucherView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<VoucherView['type']>('entire_order');
  const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('fixed');
  const [discountYuan, setDiscountYuan] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [minSpentYuan, setMinSpentYuan] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [codesText, setCodesText] = useState('');
  /** 店铺券：公开可领 + 每人限领（ADR-029）。 */
  const [isPublic, setIsPublic] = useState(false);
  const [collectLimit, setCollectLimit] = useState('1');
  /** 领取后 N 天有效（ADR-085）；空 = 用上面的固定区间。 */
  const [validDays, setValidDays] = useState('');
  /** 阶梯满减（ADR-086）：每行「满 199 减 20」，留空 = 单档。 */
  const [tiersText, setTiersText] = useState('');
  /* 适用范围（ADR-064 / ADR-092）：只有 type='specific_product' 时显示与提交 */
  const [scopeMode, setScopeMode] = useState<'include' | 'exclude'>('include');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [productTitles, setProductTitles] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productOptions, setProductOptions] = useState<ProductDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 分类加载一次就够（低频改）；商品搜索随关键词查
  useEffect(() => {
    if (!open) return;
    void listCategories()
      .then((rows) => setCategories(rows))
      .catch(() => setCategories([]));
  }, [open]);

  useEffect(() => {
    if (!open || type !== 'specific_product') return;
    const q = productQuery.trim();
    let cancelled = false;
    void listProducts({ q, limit: 20, offset: 0 })
      .then((res) => {
        if (!cancelled) setProductOptions(res.items);
      })
      .catch(() => {
        if (!cancelled) setProductOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, type, productQuery]);

  useEffect(() => {
    if (!open) return;
    setName(voucher?.name ?? '');
    setType(voucher?.type ?? 'entire_order');
    setDiscountType(voucher?.discountType ?? 'fixed');
    setDiscountYuan(voucher && voucher.discountType === 'fixed' ? minorToYuan(voucher.discountValue) : '');
    setDiscountPercent(voucher && voucher.discountType === 'percentage' ? bpsToPercent(voucher.discountValue) : '');
    setMinSpentYuan(voucher?.minSpent != null ? minorToYuan(voucher.minSpent) : '');
    setUsageLimit(voucher?.usageLimit != null ? String(voucher.usageLimit) : '');
    setStartsAt(toLocalInput(voucher?.startsAt ?? null));
    setEndsAt(toLocalInput(voucher?.endsAt ?? null));
    setCodesText('');
    setIsPublic(voucher?.isPublic ?? false);
    setCollectLimit(String(voucher?.collectLimit ?? 1));
    setValidDays(voucher?.validDays != null ? String(voucher.validDays) : '');
    setTiersText(
      (voucher?.tiers ?? [])
        .map((t) => `满 ${minorToYuan(t.minSpentMinor)} 减 ${minorToYuan(t.discountMinor)}`)
        .join('\n'),
    );
    // 范围回填（ADR-064 / ADR-092）
    setScopeMode(voucher?.scopeMode ?? 'include');
    const scopes = voucher?.scopes ?? [];
    setCategoryIds(scopes.filter((sc) => sc.scopeType === 'category').map((sc) => sc.scopeId));
    setProductIds(scopes.filter((sc) => sc.scopeType === 'product').map((sc) => sc.scopeId));
    setProductTitles({});
    setProductQuery('');
    setError(null);
    setSubmitting(false);
  }, [open, voucher]);

  const parseCodes = (): string[] =>
    codesText
      .split(/[\n,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('请输入优惠券名称');
      return;
    }
    const value = discountType === 'fixed' ? yuanToMinor(discountYuan) : percentToBps(discountPercent);
    if (value <= 0) {
      setError(discountType === 'fixed' ? '请输入有效的优惠金额' : '请输入有效的折扣百分比');
      return;
    }
    const scopes: VoucherInput['scopes'] = [
      ...categoryIds.map((id) => ({ scopeType: 'category' as const, scopeId: id })),
      ...productIds.map((id) => ({ scopeType: 'product' as const, scopeId: id })),
    ];
    if (type === 'specific_product' && scopes.length === 0) {
      setError(scopeMode === 'exclude' ? '请选择要排除的分类或商品' : '指定商品券必须至少选择一个分类或商品');
      return;
    }
    const input: VoucherInput = {
      name: name.trim(),
      type,
      discountType,
      discountValue: value,
      minSpent: minSpentYuan.trim() ? yuanToMinor(minSpentYuan) : null,
      usageLimit: usageLimit.trim() ? Math.max(0, Math.round(Number(usageLimit))) : null,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      isPublic,
      collectLimit: collectLimit.trim() ? Math.max(1, Math.round(Number(collectLimit))) : 1,
      validDays: validDays.trim() ? Math.max(1, Math.round(Number(validDays))) : null,
      tiers: parseTiers(tiersText),
      scopeMode,
      ...(voucher ? {} : { codes: parseCodes() }),
      ...(type === 'specific_product' ? { scopes } : {}),
    };
    setSubmitting(true);
    try {
      if (voucher) await updateVoucher(voucher.id, input);
      else await createVoucher(input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{voucher ? '编辑优惠券' : '新建优惠券'}</DialogTitle>
          <DialogDescription>
            金额以元为单位输入，后端统一以「分」存储与计算。停用后下次计算立即不命中。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <TextField
            id="v-name"
            label="名称"
            required
            placeholder="如 满 100 减 20"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="v-type"
              label="适用类型"
              value={type}
              onChange={(e) => setType(e.target.value as VoucherView['type'])}
              options={[
                { value: 'entire_order', label: '整单' },
                { value: 'shipping', label: '运费' },
                { value: 'specific_product', label: '指定商品' },
              ]}
            />
            <SelectField
              id="v-discount-type"
              label="折扣方式"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as 'fixed' | 'percentage')}
              options={[
                { value: 'fixed', label: '固定减免' },
                { value: 'percentage', label: '百分比折扣' },
              ]}
            />
          </div>

          {type === 'specific_product' && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">适用范围</p>
              {/* 适用范围方式（ADR-092）：指定可用 / 指定不可用 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">方式：</span>
                {(
                  [
                    { value: 'include' as const, label: '指定商品可用' },
                    { value: 'exclude' as const, label: '指定商品不可用' },
                  ]
                ).map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setScopeMode(m.value)}
                    className={
                      scopeMode === m.value
                        ? 'rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground'
                        : 'rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted'
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {scopeMode === 'exclude'
                  ? '除下面勾选的商品或分类外，全场可用；适合「除清仓外通用」这类券。'
                  : '只有勾选的商品或分类参与满减门槛与折扣计算；不选任何范围这张券用不了。'}
              </p>

              {/* 分类勾选 */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">按分类</p>
                {categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无分类，可只选商品</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((c) => {
                      const on = categoryIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setCategoryIds((prev) =>
                              on ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                            )
                          }
                          className={
                            on
                              ? 'rounded-md border border-primary bg-primary-subtle px-2 py-1 text-xs text-foreground'
                              : 'rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
                          }
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 商品搜索 + 勾选 */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">按商品（搜索后勾选）</p>
                <TextField
                  id="v-scope-product-q"
                  label=""
                  placeholder="搜索商品名称"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                />
                <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                  {productOptions.map((p) => {
                    const on = productIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          if (on) {
                            setProductIds((prev) => prev.filter((x) => x !== p.id));
                          } else {
                            setProductIds((prev) => [...prev, p.id]);
                            setProductTitles((prev) => ({ ...prev, [p.id]: p.title }));
                          }
                        }}
                        className={
                          on
                            ? 'rounded-md border border-primary bg-primary-subtle px-2 py-1 text-xs text-foreground'
                            : 'rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
                        }
                      >
                        {p.title}
                      </button>
                    );
                  })}
                  {productQuery.trim() && productOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">没有匹配的商品</p>
                  )}
                </div>
              </div>

              {/* 已选摘要 */}
              {(categoryIds.length > 0 || productIds.length > 0) && (
                <p className="text-xs text-muted-foreground">
                  已选 {categoryIds.length} 个分类、{productIds.length} 个商品
                  {productIds.map((id) => productTitles[id]).filter(Boolean).length > 0
                    ? `（${productIds.map((id) => productTitles[id]).filter(Boolean).join('、')}）`
                    : ''}
                </p>
              )}
            </div>
          )}
          {discountType === 'fixed' ? (
            <TextField
              id="v-discount-fixed"
              label="优惠金额（元）"
              type="number"
              min="0"
              step="0.01"
              required
              value={discountYuan}
              onChange={(e) => setDiscountYuan(e.target.value)}
              className="tabular"
            />
          ) : (
            <TextField
              id="v-discount-pct"
              label="折扣（%，如 20 表示打 8 折）"
              type="number"
              min="0"
              step="1"
              required
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              className="tabular"
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="v-min-spent"
              label="最低消费（元，选填）"
              type="number"
              min="0"
              step="0.01"
              placeholder="如 100"
              value={minSpentYuan}
              onChange={(e) => setMinSpentYuan(e.target.value)}
              className="tabular"
            />
            <TextField
              id="v-limit"
              label="使用次数上限（选填）"
              type="number"
              min="0"
              step="1"
              placeholder="留空不限"
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value)}
              className="tabular"
            />
          </div>
          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="size-4 accent-primary"
              />
              在店面公开领取（店铺券）
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              开启后商品页会出现「领取」按钮；顾客领取后结账时直接可选，不必输码。
            </p>
            {isPublic && (
              <div className="mt-3">
                <TextField
                  id="v-collect-limit"
                  label="每人限领张数"
                  type="number"
                  min="1"
                  step="1"
                  value={collectLimit}
                  onChange={(e) => setCollectLimit(e.target.value)}
                  className="tabular w-32"
                />
                <TextField
                  id="v-valid-days"
                  label="领取后有效天数（选填）"
                  type="number"
                  min="1"
                  step="1"
                  value={validDays}
                  onChange={(e) => setValidDays(e.target.value)}
                  className="tabular mt-3 w-40"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  填了就按「领取那一刻起 N 天」算，与固定区间取更早的截止时间。
                </p>
                <label htmlFor="v-tiers" className="mt-3 block text-xs font-medium text-muted-foreground">
                  阶梯满减（选填，每行一档：满 199 减 20）
                </label>
                <textarea
                  id="v-tiers"
                  rows={3}
                  value={tiersText}
                  onChange={(e) => setTiersText(e.target.value)}
                  placeholder={"满 199 减 20\n满 299 减 40"}
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  填了阶梯就用阶梯，单档金额与门槛不再生效；取满足门槛的最高一档。
                </p>
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="v-start"
              label="生效时间（选填）"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <TextField
              id="v-end"
              label="失效时间（选填）"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
          {!voucher && (
            <div>
              <label htmlFor="v-codes" className="mb-1 block text-sm">
                券码（选填，多个用逗号或换行分隔）
              </label>
              <Textarea
                id="v-codes"
                rows={2}
                placeholder="留空则由系统自动生成一个券码"
                value={codesText}
                onChange={(e) => setCodesText(e.target.value)}
              />
            </div>
          )}

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
            {voucher ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * 券码管理
 * ------------------------------------------------------------------ */

function VoucherCodesDialog({
  detail,
  onClose,
  onChanged,
}: {
  detail: VoucherDetailView | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [codes, setCodes] = useState<VoucherCodeView[]>([]);
  const [addText, setAddText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCodes(detail?.codes ?? []);
    setAddText('');
    setError(null);
  }, [detail]);

  if (!detail) return null;

  const refresh = async () => {
    const fresh = await getVoucher(detail.id);
    if (fresh) setCodes(fresh.codes);
  };

  const add = async () => {
    const list = addText
      .split(/[\n,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await addVoucherCodes(detail.id, list);
      setAddText('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (codeId: string) => {
    if (!window.confirm('确认删除该券码？已核销的券码删除后无法恢复。')) return;
    setBusy(true);
    try {
      await deleteVoucherCode(detail.id, codeId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleCode = async (c: VoucherCodeView) => {
    setBusy(true);
    try {
      await setVoucherCodeStatus(detail.id, c.id, !c.isActive);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>券码管理 · {detail.name}</DialogTitle>
          <DialogDescription>一券多码，每码独立计数与启停。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <Textarea
              id="v-code-add"
              rows={1}
              placeholder="输入券码，多个用逗号分隔"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
            />
            <Button onClick={() => void add()} loading={busy} className="shrink-0">
              添加
            </Button>
          </div>

          {error && (
            <p className="rounded-md border border-destructive bg-destructive-subtle px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <ul className="divide-y divide-border rounded-lg border border-border">
            {codes.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 font-mono text-xs text-foreground">{c.code}</span>
                <span className="tabular text-xs text-muted-foreground">已用 {c.used}</span>
                {c.isActive ? <Badge variant="success">可用</Badge> : <Badge variant="neutral">已停用</Badge>}
                <IconButton aria-label={`${c.isActive ? '停用' : '启用'}券码 ${c.code}`} size="sm" onClick={() => void toggleCode(c)}>
                  <Power className="size-4" strokeWidth={2} aria-hidden="true" />
                </IconButton>
                <IconButton aria-label={`删除券码 ${c.code}`} size="sm" onClick={() => void remove(c.id)}>
                  <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                </IconButton>
              </li>
            ))}
            {codes.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">暂无券码，请在上方添加</li>
            )}
          </ul>
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

/** 「满 199 减 20」→ minor；解析不了的行忽略，不让一个笔误把整张券存坏。 */
function parseTiers(text: string): Array<{ minSpentMinor: number; discountMinor: number }> | null {
  const rows = text
    .split('\n')
    .map((line) => line.match(/满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ minSpentMinor: yuanToMinor(m[1]!), discountMinor: yuanToMinor(m[2]!) }))
    .filter((t) => t.minSpentMinor > 0 && t.discountMinor > 0)
    .sort((a, b) => a.minSpentMinor - b.minSpentMinor);
  return rows.length > 0 ? rows : null;
}
