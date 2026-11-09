import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button,
  IconButton,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  cn,
} from '@mall/ui';
import { SelectField, TextField } from './field';
import { newId } from '@/lib/admin-store';
import { saveProduct } from '@/lib/admin-api';
import type { ProductDraft, ProductStatus, VariantDraft } from '@/lib/admin-data';

function minorToYuan(m: number): string {
  return (m / 100).toFixed(2);
}

function emptyVariant(): VariantDraft {
  return { id: newId('v'), sku: '', title: '', priceMinor: 0, stock: 0 };
}

/** 商品编辑器（Sheet）：基本信息 + 变体/定价/库存同屏联动。 */
export function ProductEditor({
  open,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: ProductDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [status, setStatus] = useState<ProductStatus>('draft');
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (product) {
      setTitle(product.title);
      setHandle(product.handle);
      setSubtitle(product.subtitle ?? '');
      setStatus(product.status);
      setVariants(product.variants.map((v) => ({ ...v })));
    } else {
      setTitle('');
      setHandle('');
      setSubtitle('');
      setStatus('draft');
      setVariants([emptyVariant()]);
    }
    setErrors({});
  }, [open, product]);

  const updateVariant = (id: string, patch: Partial<VariantDraft>) =>
    setVariants((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const addVariant = () => setVariants((prev) => [...prev, emptyVariant()]);
  const removeVariant = (id: string) => setVariants((prev) => (prev.length > 1 ? prev.filter((v) => v.id !== id) : prev));

  const priced = variants.map((v) => v.priceMinor).filter((p) => p > 0);
  const minPrice = priced.length ? Math.min(...priced) : 0;
  const maxPrice = priced.length ? Math.max(...priced) : 0;
  const totalStock = variants.reduce((s, v) => s + v.stock, 0);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = '请输入商品标题';
    if (!handle.trim()) e.handle = '请输入 handle';
    variants.forEach((v, i) => {
      if (!v.title.trim()) e[`v-${i}-title`] = '请输入变体名称';
      if (!v.sku.trim()) e[`v-${i}-sku`] = '请输入 SKU';
      if (v.priceMinor < 0) e[`v-${i}-price`] = '价格不能为负';
      if (v.stock < 0) e[`v-${i}-stock`] = '库存不能为负';
    });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    await saveProduct({
      id: product?.id ?? newId('p'),
      title: title.trim(),
      handle: handle.trim(),
      subtitle: subtitle.trim() || undefined,
      status,
      variants,
      createdAt: product?.createdAt ?? new Date().toISOString().slice(0, 10),
    });
    onSaved();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{product ? '编辑商品' : '新建商品'}</SheetTitle>
        </SheetHeader>
        <SheetBody>
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
          <TextField id="p-title" label="标题" required value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="p-handle"
              label="Handle"
              required
              placeholder="如 wireless-mouse"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              error={errors.handle}
              className="font-mono"
            />
            <SelectField
              id="p-status"
              label="状态"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatus)}
              options={[
                { value: 'draft', label: '草稿' },
                { value: 'published', label: '已上架' },
              ]}
            />
          </div>
          <TextField id="p-subtitle" label="副标题" placeholder="选填，一句话卖点" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">变体 · 定价 · 库存</h3>
            <Button size="sm" variant="secondary" onClick={addVariant}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              添加变体
            </Button>
          </div>
          <div className="rounded-lg border border-border">
            {variants.map((v, i) => (
              <div
                key={v.id}
                className={cn('grid gap-2 p-3 sm:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto] sm:items-end', i > 0 && 'border-t border-border')}
              >
                <TextField id={`v-${i}-title`} label="变体" value={v.title} onChange={(e) => updateVariant(v.id, { title: e.target.value })} error={errors[`v-${i}-title`]} />
                <TextField id={`v-${i}-sku`} label="SKU" value={v.sku} onChange={(e) => updateVariant(v.id, { sku: e.target.value })} error={errors[`v-${i}-sku`]} className="font-mono" />
                <TextField
                  id={`v-${i}-price`}
                  label="价格 ¥"
                  type="number"
                  min="0"
                  step="0.01"
                  value={v.priceMinor / 100}
                  onChange={(e) => updateVariant(v.id, { priceMinor: Math.round(Number(e.target.value) * 100) })}
                  error={errors[`v-${i}-price`]}
                  className="tabular"
                />
                <TextField
                  id={`v-${i}-stock`}
                  label="库存"
                  type="number"
                  min="0"
                  step="1"
                  value={v.stock}
                  onChange={(e) => updateVariant(v.id, { stock: Math.round(Number(e.target.value)) })}
                  error={errors[`v-${i}-stock`]}
                  className="tabular"
                />
                <IconButton aria-label={`删除变体 ${v.title || i + 1}`} size="sm" onClick={() => removeVariant(v.id)}>
                  <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            共 {variants.length} 个变体 · 价格区间 ¥{minorToYuan(minPrice)}–¥{minorToYuan(maxPrice)} · 总库存 {totalStock}
          </p>
        </section>
      </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save}>保存商品</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
