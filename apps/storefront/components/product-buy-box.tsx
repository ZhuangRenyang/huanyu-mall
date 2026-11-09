'use client';

import { useState } from 'react';
import { ShieldCheck, ShoppingBag, Truck } from 'lucide-react';
import { Badge, Button, Price, VariantPicker } from '@mall/ui';
import type { VariantOptionGroup } from '@mall/ui';
import { useCart } from '@/lib/cart-store';
import type { CatalogProduct } from '@/lib/mock-products';

/** 从变体推导规格选项组（单/多选项组合均适用）。 */
function optionGroups(product: CatalogProduct): VariantOptionGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const v of product.variants) {
    for (const [name, val] of Object.entries(v.options)) {
      if (!groups.has(name)) groups.set(name, new Set());
      groups.get(name)!.add(val);
    }
  }
  return [...groups.entries()].map(([name, vals]) => ({
    id: name,
    name,
    values: [...vals].map((value) => ({ value })),
  }));
}

/** `选项名:值` → 该值可用库存（0 = 售罄，交给 VariantPicker 置灰）。 */
function stockMapOf(product: CatalogProduct): Record<string, number> {
  const map: Record<string, number> = {};
  for (const v of product.variants) {
    for (const [name, val] of Object.entries(v.options)) {
      const key = `${name}:${val}`;
      map[key] = (map[key] ?? 0) + v.stock;
    }
  }
  return map;
}

export function ProductBuyBox({ product }: { product: CatalogProduct }) {
  const { addItem } = useCart();
  const groups = optionGroups(product);
  const stockMap = stockMapOf(product);
  const disabledKeys = Object.entries(stockMap)
    .filter(([, q]) => q === 0)
    .map(([k]) => k);

  const [selected, setSelected] = useState<Record<string, string>>({});
  const [hint, setHint] = useState(false);

  const allSelected = groups.every((g) => Boolean(selected[g.id]));
  const variant = groups.length === 0
    ? product.variants[0]
    : allSelected
      ? product.variants.find((v) => groups.every((g) => v.options[g.id] === selected[g.id]))
      : undefined;

  const basePrice = Math.min(...product.variants.map((v) => v.priceMinor));
  const priceMinor = variant?.priceMinor ?? basePrice;
  const originalMinor = variant?.originalMinor ?? product.originalMinor;
  const soldOut = variant ? variant.stock === 0 : false;
  const lowStock: number | undefined =
    variant && variant.stock > 0 && variant.stock <= 5 ? variant.stock : undefined;

  const handleAdd = () => {
    if (!variant) {
      setHint(true);
      return;
    }
    if (variant.stock === 0) return;
    addItem({
      id: variant.id,
      title: product.title,
      variantTitle: variant.title,
      unitPriceMinor: variant.priceMinor,
      currencyCode: 'CNY',
      imageUrl: product.images[0]?.url,
      maxQuantity: variant.stock,
    });
    setHint(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl">{product.title}</h1>
        {product.subtitle && <p className="mt-1 text-sm text-muted-foreground">{product.subtitle}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Price amountMinor={priceMinor} originalMinor={originalMinor} promo={originalMinor !== undefined} size="xl" />
        {lowStock !== undefined && <Badge variant="warning">仅剩 {lowStock} 件</Badge>}
        {soldOut && <Badge variant="neutral">暂时缺货</Badge>}
      </div>

      {groups.length > 0 && (
        <div className={hint ? 'rounded-lg p-1 ring-2 ring-ring' : ''}>
          <VariantPicker
            options={groups}
            value={selected}
            onChange={(gid, val) => {
              setSelected((prev) => ({ ...prev, [gid]: val }));
              setHint(false);
            }}
            stockMap={stockMap}
            disabledKeys={disabledKeys}
          />
        </div>
      )}
      {hint && <p className="text-sm text-destructive">请先选择规格</p>}

      <Button size="lg" className="w-full" onClick={handleAdd} disabled={soldOut}>
        <ShoppingBag className="size-5" strokeWidth={2} aria-hidden="true" />
        {soldOut ? '暂时缺货' : '加入购物车'}
      </Button>

      <div className="space-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2">
          <Truck className="size-4" strokeWidth={2} aria-hidden="true" />
          跨境直邮，7–12 个工作日送达
        </p>
        <p className="flex items-center gap-2">
          <ShieldCheck className="size-4" strokeWidth={2} aria-hidden="true" />
          正品保障，7 天无理由退换
        </p>
      </div>
    </div>
  );
}
