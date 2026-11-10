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
  return v.discountType === 'fixed'
    ? `减 ${formatMoney(v.discountValue, 'CNY')}`
    : `打 ${bpsToPercent(v.discountValue)} 折`;
}

/* ------------------------------------------------------------------ *
 * 优惠券 tab
 * ------------------------------------------------------------------ */

export function VoucherTab() {
  const [items, setItems] = useState<VoucherView[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<VoucherView | null>(null);
  const [codesFor, setCodesFor] = useState<VoucherDetailView | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listVouchers());
    } finally {
      setLoading(false);
    }
  }, []);

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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          优惠券：满减 / 折扣，支持一券多码、限额与有效期。停用后立即不参与计算。
        </p>
        <Button onClick={openCreate}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          新建优惠券
        </Button>
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
                <td className="px-4 py-3 font-medium text-foreground">{v.name}</td>
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    const input: VoucherInput = {
      name: name.trim(),
      type,
      discountType,
      discountValue: value,
      minSpent: minSpentYuan.trim() ? yuanToMinor(minSpentYuan) : null,
      usageLimit: usageLimit.trim() ? Math.max(0, Math.round(Number(usageLimit))) : null,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      ...(voucher ? {} : { codes: parseCodes() }),
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
