import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, cn, formatMoney } from '@mall/ui';
import { ProductEditor } from '@/components/product-editor';
import { bulkProductAction, deleteProduct, listProducts } from '@/lib/admin-api';
import type { ProductDraft } from '@/lib/admin-data';

/** 每页条数：与淘宝的 20 条/页对齐，足够一屏且不浪费请求。 */
const PAGE_SIZE = 20;

type StatusTab = 'all' | 'published' | 'draft';

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'published', label: '已上架' },
  { value: 'draft', label: '草稿' },
];

export function ProductsPage() {
  const [items, setItems] = useState<ProductDraft[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ all: 0, published: 0, draft: 0 });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDraft | null>(null);
  const flashTimer = useRef<number | null>(null);

  const notify = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2600);
  };

  // 搜索防抖：每敲一个字都请求后端，商品一多就是自残
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  // 换筛选条件回到第一页，否则会停在一个空页
  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listProducts({
        status: statusFilter === 'all' ? undefined : statusFilter,
        q: debouncedQuery || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
      setCounts(res.counts);
      // 选中项跟着当前结果走：已经不在列表里的取消勾选
      const visible = new Set(res.items.map((p) => p.id));
      setSelected((prev) => new Set([...prev].filter((id) => visible.has(id))));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedQuery, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // 删到当前页空了要自动退回上一页，否则用户对着空白页发呆
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (p: ProductDraft) => {
    setEditing(p);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
  };

  const onDelete = async (p: ProductDraft) => {
    if (!window.confirm(`确认删除商品「${p.title}」？`)) return;
    await deleteProduct(p.id);
    await load();
  };

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOnPageSelected = items.length > 0 && items.every((p) => selected.has(p.id));
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) for (const p of items) next.delete(p.id);
      else for (const p of items) next.add(p.id);
      return next;
    });

  const runBulk = async (action: 'publish' | 'unpublish' | 'delete') => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const verb = action === 'publish' ? '上架' : action === 'unpublish' ? '下架' : '删除';
    if (action === 'delete' && !window.confirm(`确认删除选中的 ${ids.length} 个商品？`)) return;

    setBulkBusy(true);
    setError(null);
    try {
      const res = await bulkProductAction(ids, action);
      setSelected(new Set());
      await load();
      const skipped = res.requested - res.affected;
      notify(`${verb} ${res.affected} 个商品${skipped > 0 ? `，${skipped} 个已不存在` : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${verb}失败`);
    } finally {
      setBulkBusy(false);
    }
  };

  const emptySearch = debouncedQuery !== '' || statusFilter !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">商品</h1>
        <Button onClick={openCreate}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          新建商品
        </Button>
      </div>

      {/* 状态页签（对齐淘宝商品管理的「出售中 / 仓库中 / 全部」），角标是服务端计数 */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="商品状态筛选">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={statusFilter === tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              'h-8 rounded-md px-3 text-sm transition-colors duration-150',
              statusFilter === tab.value
                ? 'bg-primary-subtle font-medium text-primary-subtle-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {tab.label}
            <span className="ml-1 text-xs text-muted-foreground">
              {tab.value === 'all' ? counts.all : tab.value === 'published' ? counts.published : counts.draft}
            </span>
          </button>
        ))}
      </div>

      <label className="relative block max-w-sm">
        <span className="sr-only">搜索商品</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标题或 handle"
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-ring"
        />
      </label>

      {/* 批量栏：选中才出现，不占日常视线 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2">
          <span className="text-sm text-foreground">已选 {selected.size} 个</span>
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void runBulk('publish')}>
            上架
          </Button>
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void runBulk('unpublish')}>
            下架
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={bulkBusy}
            onClick={() => void runBulk('delete')}
          >
            删除
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>
            取消选择
          </Button>
        </div>
      )}

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

      {items.length === 0 && !loading ? (
        <EmptyState
          icon={Package}
          title={emptySearch ? '没有匹配的商品' : '还没有商品'}
          description={emptySearch ? '换个关键词或切到「全部」看看' : '新建第一个商品，开始经营店铺'}
          action={<Button onClick={openCreate}>新建商品</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label="全选本页商品"
                    className="size-3.5 accent-primary"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                  />
                </th>
                <th scope="col" className="px-4 py-3 font-medium">商品</th>
                <th scope="col" className="px-4 py-3 font-medium">SKU</th>
                <th scope="col" className="px-4 py-3 font-medium">价格</th>
                <th scope="col" className="px-4 py-3 font-medium">库存</th>
                <th scope="col" className="px-4 py-3 font-medium">状态</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  selected={selected.has(p.id)}
                  onToggle={() => toggleOne(p.id)}
                  onEdit={() => openEdit(p)}
                  onDelete={() => void onDelete(p)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-xs text-muted-foreground">共 {total} 个商品</span>
          <Button size="sm" variant="ghost" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="tabular text-muted-foreground">
            {page} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= pageCount || loading}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      <ProductEditor
        open={editorOpen}
        product={editing}
        onClose={closeEditor}
        onSaved={() => {
          void load();
          closeEditor();
        }}
      />
    </div>
  );
}

function ProductRow({
  product,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  product: ProductDraft;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const priced = product.variants.map((v) => v.priceMinor);
  const min = priced.length ? Math.min(...priced) : 0;
  const totalStock = product.variants.reduce((s, v) => s + v.stock, 0);
  return (
    <tr className={cn('transition-colors duration-150 hover:bg-muted/50', selected && 'bg-muted/40')}>
      <td className="px-3 py-3">
        <input
          type="checkbox"
          aria-label={`选择 ${product.title}`}
          className="size-3.5 accent-primary"
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {product.thumbnailUrl ? (
            <img
              src={product.thumbnailUrl}
              alt=""
              className="size-10 shrink-0 rounded-md border border-border object-cover"
            />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
              <Package className="size-5" strokeWidth={2} aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{product.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {product.variants.length} 个变体 · {product.subtitle ?? product.handle}
            </span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{product.variants[0]?.sku ?? '—'}</td>
      <td className="tabular px-4 py-3">
        {formatMoney(min, 'CNY')}
        {priced.length > 1 ? ' 起' : ''}
      </td>
      <td className="tabular px-4 py-3">{totalStock}</td>
      <td className="px-4 py-3">
        {product.status === 'published' ? (
          <Badge variant="success">已上架</Badge>
        ) : (
          <Badge variant="neutral">草稿</Badge>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1">
          <IconButton aria-label={`编辑 ${product.title}`} size="sm" onClick={onEdit}>
            <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
          </IconButton>
          <IconButton aria-label={`删除 ${product.title}`} size="sm" onClick={onDelete}>
            <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}
