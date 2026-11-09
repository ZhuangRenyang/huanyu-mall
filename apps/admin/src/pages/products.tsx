import { useEffect, useState } from 'react';
import { Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, formatMoney } from '@mall/ui';
import { ProductEditor } from '@/components/product-editor';
import { deleteProduct, listProducts } from '@/lib/admin-api';
import type { ProductDraft } from '@/lib/admin-data';

const PAGE_SIZE = 8;

export function ProductsPage() {
  const [products, setProducts] = useState<ProductDraft[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDraft | null>(null);

  useEffect(() => {
    void listProducts().then(setProducts);
  }, []);

  const refresh = () => {
    void listProducts().then(setProducts);
  };

  const filtered = products.filter((p) => {
    const q = query.trim().toLowerCase();
    return !q || p.title.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
  const onDelete = (p: ProductDraft) => {
    if (window.confirm(`确认删除商品「${p.title}」？此操作不可撤销。`)) {
      void deleteProduct(p.id).then(refresh);
      refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">商品</h1>
        <Button onClick={openCreate}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          新建商品
        </Button>
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
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="搜索标题或 handle"
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-ring"
        />
      </label>

      {pageItems.length === 0 ? (
        <EmptyState
          icon={Package}
          title={query ? '没有匹配的商品' : '还没有商品'}
          description={query ? '换个关键词试试' : '新建第一个商品，开始经营店铺'}
          action={<Button onClick={openCreate}>新建商品</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">商品</th>
                <th scope="col" className="px-4 py-3 font-medium">SKU</th>
                <th scope="col" className="px-4 py-3 font-medium">价格</th>
                <th scope="col" className="px-4 py-3 font-medium">库存</th>
                <th scope="col" className="px-4 py-3 font-medium">状态</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageItems.map((p) => (
                <ProductRow key={p.id} product={p} onEdit={() => openEdit(p)} onDelete={() => onDelete(p)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="ghost" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            上一页
          </Button>
          <span className="tabular text-muted-foreground">
            {safePage} / {pageCount}
          </span>
          <Button size="sm" variant="ghost" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
            下一页
          </Button>
        </div>
      )}

      <ProductEditor
        open={editorOpen}
        product={editing}
        onClose={closeEditor}
        onSaved={() => {
          refresh();
          closeEditor();
        }}
      />
    </div>
  );
}

function ProductRow({ product, onEdit, onDelete }: { product: ProductDraft; onEdit: () => void; onDelete: () => void }) {
  const priced = product.variants.map((v) => v.priceMinor);
  const min = priced.length ? Math.min(...priced) : 0;
  const totalStock = product.variants.reduce((s, v) => s + v.stock, 0);
  return (
    <tr className="transition-colors duration-150 hover:bg-muted/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
            <Package className="size-5" strokeWidth={2} aria-hidden="true" />
          </span>
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
      <td className="px-4 py-3">{product.status === 'published' ? <Badge variant="success">已上架</Badge> : <Badge variant="neutral">草稿</Badge>}</td>
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
