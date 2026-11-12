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
import { SelectField, TextAreaField, TextField } from './field';
import { ImageUploader } from './image-uploader';
import { getShippingConfig, type ShippingProfileView } from '@/lib/admin-shipping';
import { Switch } from '@mall/ui';
import { newId } from '@/lib/admin-store';
import { saveProduct } from '@/lib/admin-api';
import type { ProductDraft, ProductImageDraft, ProductStatus, VariantDraft } from '@/lib/admin-data';

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
  /** 运费归属：模板 + 卖家包邮（淘宝发布页的「物流信息」）。 */
  const [profiles, setProfiles] = useState<ShippingProfileView[]>([]);
  const [profileId, setProfileId] = useState<string>('');
  const [freeShipping, setFreeShipping] = useState(false);
  /** 图集（第一张主图）与详情描述 —— 淘宝发布页在「价格库存」之后。 */
  const [images, setImages] = useState<ProductImageDraft[]>([]);
  const [description, setDescription] = useState('');

  useEffect(() => {
    void getShippingConfig()
      .then((c) => setProfiles(c.profiles))
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    if (product) {
      setTitle(product.title);
      setHandle(product.handle);
      setSubtitle(product.subtitle ?? '');
      setStatus(product.status);
      setVariants(product.variants.map((v) => ({ ...v })));
      setProfileId(product.shippingProfileId ?? '');
      setFreeShipping(product.freeShipping ?? false);
      setImages(product.images ?? []);
      setDescription(product.description ?? '');
    } else {
      setTitle('');
      setHandle('');
      setSubtitle('');
      setStatus('draft');
      setVariants([emptyVariant()]);
      setProfileId('');
      setFreeShipping(false);
      setImages([]);
      setDescription('');
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
      shippingProfileId: profileId || null,
      freeShipping,
      description: description.trim() || undefined,
      images,
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

        {/*
          运费（淘宝发布页的「物流信息」）。
          位置照淘宝：在**价格与库存之后**，不是标题后面 ——
          商家填价、填库存、再决定怎么发货，是发布商品的自然顺序。
          商品只负责「用哪套模板 / 是否包邮」，金额在模板里配。
        */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">运费</h3>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              卖家包邮
              <Switch
                checked={freeShipping}
                onCheckedChange={setFreeShipping}
                aria-label={freeShipping ? '取消卖家包邮' : '设为卖家包邮'}
              />
            </span>
          </div>
          <SelectField
            id="p-shipping-profile"
            label="运费模板"
            value={profileId || '__default__'}
            onChange={(e) => setProfileId(e.target.value === '__default__' ? '' : e.target.value)}
            disabled={freeShipping}
            options={[
              { value: '__default__', label: '默认模板' },
              ...profiles
                .filter((p) => !p.isDefault)
                .map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {freeShipping
              ? '本商品不向顾客收运费，运费由商家承担（其金额也不计入满额包邮门槛）。'
              : '结账时按收货国家自动匹配模板里的运费，顾客不用选。模板在「商品 → 运费模板」里维护。'}
          </p>
        </section>

        {/* 商品图片：淘宝发布页在物流信息之后 */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">商品图片</h3>
          <ImageUploader images={images} onChange={setImages} />
        </section>

        {/* 商品详情：淘宝最后一块是详情描述 */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">商品详情</h3>
          <TextAreaField
            id="p-description"
            label="详情描述"
            placeholder="材质、尺寸、使用说明……空行分段，店面按段落展示"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[140px]"
          />
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
