'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PackageOpen, Search, X } from 'lucide-react';
import { Button, EmptyState, ProductCardSkeleton, cn } from '@mall/ui';
import { ProductCard } from './product-card';
import type { AttributeGroup, MockCategory, StoreProduct } from '@/lib/mock-products';

interface ProductListingProps {
  products: StoreProduct[];
  categories: MockCategory[];
  attributeGroups: AttributeGroup[];
  /** 语言+渠道前缀，如 `/zh-CN/cn`。 */
  basePath: string;
  initialQuery?: string;
  initialCategory?: string;
  /** live 模式：筛选与排序由服务端完成，前端只渲染并把交互转成 URL 查询。 */
  serverFiltered?: boolean;
}

const SORT_OPTIONS = [
  { value: 'created_at.desc', label: '最新上架' },
  { value: 'price.asc', label: '价格从低到高' },
  { value: 'price.desc', label: '价格从高到低' },
] as const;

export function ProductListing({
  products,
  categories,
  attributeGroups,
  basePath,
  initialQuery = '',
  initialCategory,
  serverFiltered = false,
}: ProductListingProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(initialCategory ? [initialCategory] : []);
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<string>('created_at.desc');

  /** live 模式：把筛选/排序/搜索写回 URL，由服务端重新取数。 */
  const applyQuery = useCallback(
    (next: { q?: string; category?: string; sort?: string }) => {
      const sp = new URLSearchParams();
      const q = next.q ?? query;
      const category = next.category;
      const sortKey = next.sort ?? sort;
      if (q.trim()) sp.set('q', q);
      if (category) sp.set('category', category);
      if (sortKey) sp.set('sort', sortKey);
      router.push(`${pathname}${sp.toString() ? `?${sp.toString()}` : ''}`);
    },
    [query, sort, router, pathname],
  );
  const [loading, setLoading] = useState(!serverFiltered);

  // mock 模式模拟首屏拉取；live 模式数据在 SSR 阶段已就绪，直接出内容（不闪骨架屏）
  useEffect(() => {
    if (serverFiltered) return;
    const t = window.setTimeout(() => setLoading(false), 300);
    return () => window.clearTimeout(t);
  }, [serverFiltered]);

  // 搜索防抖 300ms（live 写 URL 触发服务端取数；mock 走本地）
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (serverFiltered) applyQuery({ q: query });
      else setDebouncedQuery(query);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, serverFiltered, applyQuery]);

  const filtered = useMemo(() => {
    if (serverFiltered) return products;
    const q = debouncedQuery.trim().toLowerCase();
    const list = products.filter((p) => {
      if (q && !`${p.title} ${p.subtitle ?? ''}`.toLowerCase().includes(q)) return false;
      if (selectedCategories.length > 0 && !selectedCategories.includes(p.categoryId)) return false;
      for (const group of attributeGroups) {
        const chosen = selectedAttrs[group.name];
        if (!chosen || chosen.length === 0) continue;
        if (!p.attributes.some((a) => a.name === group.name && chosen.includes(a.value))) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === 'price.asc') return (a.price?.amount_minor ?? 0) - (b.price?.amount_minor ?? 0);
      if (sort === 'price.desc') return (b.price?.amount_minor ?? 0) - (a.price?.amount_minor ?? 0);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [products, debouncedQuery, selectedCategories, selectedAttrs, sort, attributeGroups, serverFiltered]);

  const hasFilters =
    selectedCategories.length > 0 ||
    Object.values(selectedAttrs).some((v) => v.length > 0) ||
    query.trim() !== '';

  const toggleCategory = (id: string) => {
    if (serverFiltered) {
      const cur = selectedCategories[0] === id ? [] : [id];
      applyQuery({ category: cur[0] });
      return;
    }
    setSelectedCategories((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleAttr = (name: string, value: string) =>
    setSelectedAttrs((prev) => {
      const cur = prev[name] ?? [];
      return { ...prev, [name]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  // 两级分类：一行一级；选中一级后，下面再出一行它的二级（淘宝就是这个层级）
  const rootCategories = categories.filter((c) => !c.parentId);
  const selectedCategory = categories.find((c) => c.id === selectedCategories[0]);
  const activeRoot = selectedCategory
    ? (selectedCategory.parentId
        ? categories.find((c) => c.id === selectedCategory.parentId)
        : selectedCategory)
    : undefined;
  const subCategories = activeRoot
    ? categories.filter((c) => c.parentId === activeRoot.id)
    : [];

  const clearCategory = () => setSelectedCategories([]);
  const clearAttr = (name: string) => setSelectedAttrs((prev) => ({ ...prev, [name]: [] }));
  const clearFilters = () => {
    if (serverFiltered) {
      router.push(pathname);
      return;
    }
    setSelectedCategories([]);
    setSelectedAttrs({});
    setQuery('');
  };

  return (
    <div className="mx-auto max-w-content px-4 py-6 md:py-8">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h1 className="text-xl md:text-2xl">全部商品</h1>
        <span className="tabular text-sm text-muted-foreground">{filtered.length} 件</span>
      </div>

      {/* 工具条：搜索（防抖）+ 排序 */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">搜索商品</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索商品名称"
            className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm outline-none transition-colors duration-150 focus:border-ring"
          />
        </label>
        <select
          aria-label="排序方式"
          value={sort}
          onChange={(e) => (serverFiltered ? applyQuery({ sort: e.target.value }) : setSort(e.target.value))}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-ring"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* 筛选 chips：分类 + 属性 */}
      <div className="mb-6 space-y-2">
        <FilterRow
          label="分类"
          values={(rootCategories.length > 0 ? rootCategories : categories).map((c) => ({
            key: c.id,
            label: c.name,
          }))}
          selected={selectedCategories}
          onToggle={toggleCategory}
          onClear={clearCategory}
        />
        {activeRoot && subCategories.length > 0 && (
          <FilterRow
            label={activeRoot.name}
            values={subCategories.map((c) => ({ key: c.id, label: c.name }))}
            selected={selectedCategories}
            onToggle={toggleCategory}
            // 「全部」回到一级分类本身，而不是清空筛选（否则一级那一行的高亮也对不上）
            onClear={() => toggleCategory(activeRoot.id)}
          />
        )}
        {attributeGroups.map((g) => (
          <FilterRow
            key={g.name}
            label={g.name}
            values={g.values.map((v) => ({ key: v, label: v }))}
            selected={selectedAttrs[g.name] ?? []}
            onToggle={(v) => toggleAttr(g.name, v)}
            onClear={() => clearAttr(g.name)}
          />
        ))}
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <X className="size-4" strokeWidth={2} aria-hidden="true" /> 清除筛选
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="这个筛选条件下暂时没有商品"
          description="试着放宽筛选条件，或者看看全部商品"
          action={
            <Button variant="secondary" size="md" onClick={clearFilters}>
              清除筛选
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
          {filtered.map((p, i) => (
            <ProductCard key={p.id} product={p} basePath={basePath} priority={i < 4} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FilterRowProps {
  label: string;
  values: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}

function FilterRow({ label, values, selected, onToggle, onClear }: FilterRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-sm text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-pressed={selected.length === 0}
        className={cn(
          'h-8 rounded-full px-3 text-sm transition-colors duration-150',
          selected.length === 0 ? 'bg-primary-subtle text-primary-subtle-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
        )}
      >
        全部
      </button>
      {values.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onToggle(v.key)}
          aria-pressed={selected.includes(v.key)}
          className={cn(
            'h-8 rounded-full px-3 text-sm transition-colors duration-150',
            selected.includes(v.key) ? 'bg-primary-subtle text-primary-subtle-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
