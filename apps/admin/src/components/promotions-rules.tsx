import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Power, Tag, Trash2 } from 'lucide-react';
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
  addPromotionRule,
  createPromotion,
  deletePromotion,
  deletePromotionRule,
  getPromotion,
  listPromotions,
  setPromotionStatus,
} from '@/lib/admin-api';
import type {
  PromotionDetailView,
  PromotionInput,
  PromotionRuleView,
  PromotionView,
} from '@/lib/admin-api';

/* ------------------------------------------------------------------ *
 * 换算：金额 minor unit（分）；百分比为万分比 bps（2000=20%）。
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

const TYPE_LABEL: Record<PromotionView['type'], string> = {
  catalogue: '目录促销',
  order: '订单促销',
};

const STATUS_LABEL: Record<PromotionView['status'], string> = {
  draft: '草稿',
  active: '启用中',
  inactive: '已停用',
};

/** 条件谓词 → 人话。空谓词在后端恒不命中，这里必须显式提示。 */
function predicateText(p: Record<string, unknown>): string {
  if ('subtotalGte' in p) return `满 ${formatMoney(Number(p.subtotalGte), 'CNY')}`;
  if ('categoryIds' in p) return `分类 ${(p.categoryIds as string[]).join('、')}`;
  if ('variantIds' in p) return `变体 ${(p.variantIds as string[]).join('、')}`;
  if ('currencyEq' in p) return `币种 ${String(p.currencyEq)}`;
  if ('and' in p) return `且(${(p.and as Record<string, unknown>[]).map(predicateText).join(' & ')})`;
  if ('or' in p) return `或(${(p.or as Record<string, unknown>[]).map(predicateText).join(' | ')})`;
  return '未设条件（不命中）';
}

/** 规则动作 → 人话。fixed 在目录促销里是「每件减」，在订单促销里是「整单减」。 */
function rewardText(rule: PromotionRuleView, type: PromotionView['type']): string {
  if (rule.rewardType === 'percentage') return `减 ${bpsToPercent(rule.rewardValue)}%`;
  return type === 'catalogue'
    ? `每件减 ${formatMoney(rule.rewardValue, 'CNY')}`
    : `整单减 ${formatMoney(rule.rewardValue, 'CNY')}`;
}

function periodText(p: PromotionView): string {
  if (!p.startsAt && !p.endsAt) return '长期有效';
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('zh-CN');
  return `${p.startsAt ? fmt(p.startsAt) : '即刻'} ~ ${p.endsAt ? fmt(p.endsAt) : '长期'}`;
}

/* ------------------------------------------------------------------ *
 * 促销 tab
 * ------------------------------------------------------------------ */

export function PromotionTab() {
  const [items, setItems] = useState<PromotionView[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  /** 类型与状态筛选：与搜索一起走服务端（ADR-043）。 */
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [detail, setDetail] = useState<PromotionDetailView | null>(null);

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
      const res = await listPromotions({
        q: applied || undefined,
        type: type || undefined,
        status: status || undefined,
        limit: 20,
        offset: page * 20,
      });
      setItems(res.items);
      setTotal(res.total);
      setHasMore(res.hasMore);
    } finally {
      setLoading(false);
    }
  }, [applied, page, type, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDetail = async (p: PromotionView) => {
    const full = await getPromotion(p.id);
    if (full) setDetail(full);
  };

  const toggleStatus = async (p: PromotionView) => {
    await setPromotionStatus(p.id, p.status !== 'active');
    await refresh();
  };

  const remove = async (p: PromotionView) => {
    if (!window.confirm(`删除促销「${p.name}」？删除后立即不再参与计算（历史订单留痕不受影响）。`)) return;
    await deletePromotion(p.id);
    await refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          目录促销按商品打折（行级），订单促销按小计满减（订单级），均自动命中、无需输码。停用后立即不参与计算。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={query} onChange={setQuery} placeholder="搜索活动名称或码" />
          <select
            aria-label="促销类型"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="">全部类型</option>
            <option value="catalogue">目录促销</option>
            <option value="order">订单促销</option>
          </select>
          <select
            aria-label="促销状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="active">启用中</option>
            <option value="inactive">已停用</option>
          </select>
          <Button onClick={() => setEditorOpen(true)}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            新建促销
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">已用</th>
              <th className="px-4 py-3 font-medium">有效期</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((p) => (
              <tr key={p.id} className="transition-colors duration-150 hover:bg-muted/50">
                <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{TYPE_LABEL[p.type]}</td>
                <td className="px-4 py-3">
                  {p.status === 'active' ? (
                    <Badge variant="success">启用中</Badge>
                  ) : p.status === 'draft' ? (
                    <Badge variant="neutral">草稿</Badge>
                  ) : (
                    <Badge variant="neutral">已停用</Badge>
                  )}
                </td>
                <td className="tabular px-4 py-3 text-muted-foreground">
                  {p.used}
                  {p.usageLimit != null ? ` / ${p.usageLimit}` : ''}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{periodText(p)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <IconButton aria-label={`查看 ${p.name} 的规则`} size="sm" onClick={() => void openDetail(p)}>
                      <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-label={p.status === 'active' ? `停用 ${p.name}` : `启用 ${p.name}`}
                      size="sm"
                      onClick={() => void toggleStatus(p)}
                    >
                      <Power className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                    <IconButton aria-label={`删除 ${p.name}`} size="sm" onClick={() => void remove(p)}>
                      <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  还没有促销，点「新建促销」创建第一条
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

      <PromotionEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={async () => {
          setEditorOpen(false);
          await refresh();
        }}
      />

      <PromotionDetailDialog
        detail={detail}
        onClose={() => setDetail(null)}
        onChanged={async () => {
          await refresh();
          if (detail) setDetail(await getPromotion(detail.id));
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 新建
 * ------------------------------------------------------------------ */

type CatalogueScope = 'categoryIds' | 'variantIds';

function PromotionEditor({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PromotionView['type']>('order');
  const [minSpentYuan, setMinSpentYuan] = useState('0');
  const [scope, setScope] = useState<CatalogueScope>('categoryIds');
  const [scopeIds, setScopeIds] = useState('');
  const [rewardType, setRewardType] = useState<'fixed' | 'percentage'>('fixed');
  const [rewardYuan, setRewardYuan] = useState('');
  const [rewardPercent, setRewardPercent] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setType('order');
    setMinSpentYuan('0');
    setScope('categoryIds');
    setScopeIds('');
    setRewardType('fixed');
    setRewardYuan('');
    setRewardPercent('');
    setUsageLimit('');
    setStartsAt('');
    setEndsAt('');
    setError(null);
    setSubmitting(false);
  }, [open]);

  const parseIds = (): string[] =>
    scopeIds
      .split(/[\n,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('请输入促销名称');
      return;
    }

    let predicate: Record<string, unknown>;
    if (type === 'order') {
      const min = yuanToMinor(minSpentYuan || '0');
      if (min < 0) {
        setError('最低消费不能为负');
        return;
      }
      // subtotalGte 是订单级条件；0 表示无门槛（小计恒 >= 0，必然命中）。
      predicate = { subtotalGte: min };
    } else {
      const ids = parseIds();
      if (ids.length === 0) {
        setError('目录促销必须指定适用分类或变体（后端空条件不会命中）');
        return;
      }
      predicate = { [scope]: ids };
    }

    const value = rewardType === 'fixed' ? yuanToMinor(rewardYuan) : percentToBps(rewardPercent);
    if (value <= 0) {
      setError(rewardType === 'fixed' ? '请输入有效的优惠金额' : '请输入有效的折扣百分比');
      return;
    }
    if (rewardType === 'percentage' && value > 10000) {
      setError('百分比折扣不得超过 100%');
      return;
    }

    const input: PromotionInput = {
      name: name.trim(),
      type,
      isAutomatic: true,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      usageLimit: usageLimit.trim() ? Math.max(0, Math.round(Number(usageLimit))) : null,
      predicate,
      rewardType,
      rewardValue: value,
    };

    setSubmitting(true);
    try {
      await createPromotion(input);
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
          <DialogTitle>新建促销</DialogTitle>
          <DialogDescription>
            金额以元输入、按分存储；百分比按万分比存储。新建后为草稿状态，确认无误再启用。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <TextField
            id="p-name"
            label="名称"
            required
            placeholder="如 满 200 减 30 / 冬季外套 9 折"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <SelectField
            id="p-type"
            label="促销类型"
            value={type}
            onChange={(e) => setType(e.target.value as PromotionView['type'])}
            options={[
              { value: 'order', label: '订单促销（按小计满减 / 满折）' },
              { value: 'catalogue', label: '目录促销（按商品打折，行级）' },
            ]}
          />

          {type === 'order' ? (
            <TextField
              id="p-min"
              label="最低消费（元）"
              inputMode="decimal"
              placeholder="0 表示无门槛"
              value={minSpentYuan}
              onChange={(e) => setMinSpentYuan(e.target.value)}
            />
          ) : (
            <>
              <SelectField
                id="p-scope"
                label="适用范围"
                value={scope}
                onChange={(e) => setScope(e.target.value as CatalogueScope)}
                options={[
                  { value: 'categoryIds', label: '按分类' },
                  { value: 'variantIds', label: '按变体' },
                ]}
              />
              <TextField
                id="p-scope-ids"
                label={scope === 'categoryIds' ? '分类 ID（逗号分隔）' : '变体 ID（逗号分隔）'}
                required
                placeholder="cat_xxx, cat_yyy"
                value={scopeIds}
                onChange={(e) => setScopeIds(e.target.value)}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                分类挂在商品上，后端会经「变体 → 商品 → 分类」匹配。
              </p>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="p-reward-type"
              label="优惠方式"
              value={rewardType}
              onChange={(e) => setRewardType(e.target.value as 'fixed' | 'percentage')}
              options={[
                { value: 'fixed', label: type === 'catalogue' ? '每件减固定金额' : '整单减固定金额' },
                { value: 'percentage', label: '按百分比减' },
              ]}
            />
            {rewardType === 'fixed' ? (
              <TextField
                id="p-reward-yuan"
                label={type === 'catalogue' ? '每件减（元）' : '整单减（元）'}
                inputMode="decimal"
                placeholder="30"
                value={rewardYuan}
                onChange={(e) => setRewardYuan(e.target.value)}
              />
            ) : (
              <TextField
                id="p-reward-percent"
                label="优惠百分比（%）"
                inputMode="decimal"
                placeholder="10 表示减 10%"
                value={rewardPercent}
                onChange={(e) => setRewardPercent(e.target.value)}
              />
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="p-starts"
              label="开始时间"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <TextField
              id="p-ends"
              label="结束时间"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>

          <TextField
            id="p-limit"
            label="使用次数上限（留空不限）"
            inputMode="numeric"
            placeholder="如 500"
            value={usageLimit}
            onChange={(e) => setUsageLimit(e.target.value)}
          />

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? '保存中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * 详情：规则列表 + 追加 / 删除规则
 * ------------------------------------------------------------------ */

function PromotionDetailDialog({
  detail,
  onClose,
  onChanged,
}: {
  detail: PromotionDetailView | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [rewardType, setRewardType] = useState<'fixed' | 'percentage'>('fixed');
  const [rewardYuan, setRewardYuan] = useState('');
  const [rewardPercent, setRewardPercent] = useState('');
  const [minSpentYuan, setMinSpentYuan] = useState('0');
  const [scope, setScope] = useState<CatalogueScope>('categoryIds');
  const [scopeIds, setScopeIds] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAdding(false);
    setError(null);
  }, [detail]);

  if (!detail) return null;

  const addRule = async () => {
    setError(null);
    let predicate: Record<string, unknown>;
    if (detail.type === 'order') {
      predicate = { subtotalGte: yuanToMinor(minSpentYuan || '0') };
    } else {
      const ids = scopeIds
        .split(/[\n,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        setError('目录促销规则必须指定分类或变体');
        return;
      }
      predicate = { [scope]: ids };
    }
    const value = rewardType === 'fixed' ? yuanToMinor(rewardYuan) : percentToBps(rewardPercent);
    if (value <= 0) {
      setError('请输入有效的优惠值');
      return;
    }
    if (rewardType === 'percentage' && value > 10000) {
      setError('百分比折扣不得超过 100%');
      return;
    }
    await addPromotionRule(detail.id, { predicate, rewardType, rewardValue: value });
    setAdding(false);
    setRewardYuan('');
    setRewardPercent('');
    setScopeIds('');
    await onChanged();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{detail.name}</DialogTitle>
          <DialogDescription>
            {TYPE_LABEL[detail.type]} · {STATUS_LABEL[detail.status]} · {periodText(detail)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">规则（条件 + 优惠）</p>
            {detail.rules.length === 0 ? (
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                还没有规则。没有规则的促销不会命中任何订单。
              </p>
            ) : (
              <ul className="space-y-2">
                {detail.rules.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span className="text-sm text-foreground">
                      {predicateText(r.predicate)} → {rewardText(r, detail.type)}
                    </span>
                    <IconButton
                      aria-label="删除该规则"
                      size="sm"
                      onClick={async () => {
                        await deletePromotionRule(r.id);
                        await onChanged();
                      }}
                    >
                      <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {adding ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              {detail.type === 'order' ? (
                <TextField
                  id="d-min"
                  label="最低消费（元）"
                  inputMode="decimal"
                  value={minSpentYuan}
                  onChange={(e) => setMinSpentYuan(e.target.value)}
                />
              ) : (
                <>
                  <SelectField
                    id="d-scope"
                    label="适用范围"
                    value={scope}
                    onChange={(e) => setScope(e.target.value as CatalogueScope)}
                    options={[
                      { value: 'categoryIds', label: '按分类' },
                      { value: 'variantIds', label: '按变体' },
                    ]}
                  />
                  <TextField
                    id="d-scope-ids"
                    label={scope === 'categoryIds' ? '分类 ID（逗号分隔）' : '变体 ID（逗号分隔）'}
                    value={scopeIds}
                    onChange={(e) => setScopeIds(e.target.value)}
                  />
                </>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  id="d-reward-type"
                  label="优惠方式"
                  value={rewardType}
                  onChange={(e) => setRewardType(e.target.value as 'fixed' | 'percentage')}
                  options={[
                    { value: 'fixed', label: detail.type === 'catalogue' ? '每件减固定金额' : '整单减固定金额' },
                    { value: 'percentage', label: '按百分比减' },
                  ]}
                />
                {rewardType === 'fixed' ? (
                  <TextField
                    id="d-reward-yuan"
                    label="金额（元）"
                    inputMode="decimal"
                    value={rewardYuan}
                    onChange={(e) => setRewardYuan(e.target.value)}
                  />
                ) : (
                  <TextField
                    id="d-reward-percent"
                    label="百分比（%）"
                    inputMode="decimal"
                    value={rewardPercent}
                    onChange={(e) => setRewardPercent(e.target.value)}
                  />
                )}
              </div>
              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                  取消
                </Button>
                <Button size="sm" onClick={() => void addRule()}>
                  添加
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              追加规则
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
