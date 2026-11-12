import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Plus, Tag } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton } from '@mall/ui';
import { TextField } from '@/components/field';
import {
  buildTree,
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
  type CategoryView,
} from '@/lib/admin-categories';

interface FormState {
  /** 编辑中的分类；空 = 新建。 */
  id?: string;
  parentId: string | null;
  name: string;
  handle: string;
  sortOrder: string;
}

const EMPTY_FORM: FormState = { parentId: null, name: '', handle: '', sortOrder: '0' };

/**
 * 商品分类（ADR-028）。
 *
 * 位置与淘宝一致：**商品 → 分类**，紧跟商品列表 —— 分类是商品的组织方式，
 * 不是「设置」里的系统参数。
 *
 * 列表按商家维护的顺序展示（一级 → 二级），每行带商品数：
 * 数量是判断「这个分类还要不要」的唯一依据，比只显示名字有用。
 */
export function CategoriesPage() {
  const [list, setList] = useState<CategoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await listCategories());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '读取分类失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = (parentId: string | null) => {
    setError(null);
    setConfirmingId(null);
    setForm({ ...EMPTY_FORM, parentId });
  };

  const openEdit = (cat: CategoryView) => {
    setError(null);
    setConfirmingId(null);
    setForm({
      id: cat.id,
      parentId: cat.parentId,
      name: cat.name,
      handle: cat.handle,
      sortOrder: String(cat.sortOrder),
    });
  };

  const save = async () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setError('分类名称不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sortOrder = Number(form.sortOrder);
      const payload = {
        name,
        ...(form.handle.trim() ? { handle: form.handle.trim() } : {}),
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      };
      if (form.id) await updateCategory(form.id, payload);
      else await createCategory({ ...payload, parentId: form.parentId });
      setForm(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await deleteCategory(id);
      setConfirmingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const tree = buildTree(list);

  const renderForm = (parentName?: string) =>
    form && (
      <div className="mt-2 rounded-lg border border-border bg-card p-3">
        <p className="mb-2 text-xs text-muted-foreground">
          {form.id ? '编辑分类' : parentName ? `在「${parentName}」下新建子分类` : '新建一级分类'}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            id="category-name"
            label="分类名称"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="如：外套"
            className="min-w-40"
          />
          <TextField
            id="category-handle"
            label="标识（可选）"
            value={form.handle}
            onChange={(e) => setForm({ ...form, handle: e.target.value })}
            placeholder="如：coats（留空自动生成）"
            className="min-w-40"
          />
          <TextField
            id="category-sort"
            label="排序"
            inputMode="numeric"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            placeholder="数字越小越靠前"
            className="w-24"
          />
          <Button onClick={() => void save()} loading={saving}>
            保存
          </Button>
          <Button variant="ghost" onClick={() => setForm(null)} disabled={saving}>
            取消
          </Button>
        </div>
      </div>
    );

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">商品分类</h1>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            顾客按分类逛店。最多两级：一级分类下再挂二级。
            删除前要先把该分类下的商品移到别处，否则商品会挂在「不存在的分类」下。
          </p>
        </div>
        {!form && (
          <Button onClick={() => openCreate(null)}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            新建一级分类
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : tree.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="还没有分类"
          description="建几个分类，顾客才能按类目逛店（如「服饰 → 外套」）"
          action={<Button onClick={() => openCreate(null)}>新建一级分类</Button>}
        />
      ) : (
        <div className="space-y-3">
          {tree.map((node) => (
            <section key={node.id} className="rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                  <span className="text-sm font-semibold text-foreground">{node.name}</span>
                  <Badge variant="neutral">{node.productCount} 件商品</Badge>
                  <span className="text-xs text-muted-foreground">排序 {node.sortOrder}</span>
                </div>
                <RowActions
                  busy={busyId === node.id}
                  confirming={confirmingId === node.id}
                  onAddChild={() => openCreate(node.id)}
                  onEdit={() => openEdit(node)}
                  onAskDelete={() => setConfirmingId(node.id)}
                  onCancelDelete={() => setConfirmingId(null)}
                  onDelete={() => void remove(node.id)}
                />
              </div>

              {form && form.parentId === node.id && <div className="px-3 pb-3">{renderForm(node.name)}</div>}

              {node.children.length > 0 && (
                <ul className="divide-y divide-border border-t border-border">
                  {node.children.map((child) => (
                    <li key={child.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 pl-9">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-sm text-foreground">{child.name}</span>
                        <Badge variant="neutral">{child.productCount} 件商品</Badge>
                        <span className="text-xs text-muted-foreground">排序 {child.sortOrder}</span>
                      </div>
                      <RowActions
                        busy={busyId === child.id}
                        confirming={confirmingId === child.id}
                        onEdit={() => openEdit(child)}
                        onAskDelete={() => setConfirmingId(child.id)}
                        onCancelDelete={() => setConfirmingId(null)}
                        onDelete={() => void remove(child.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {/* 新建一级分类的表单挂在列表末尾，和淘宝「新增分类」的位置一致 */}
          {form && form.parentId === null && <section className="rounded-lg border border-border bg-card p-3">{renderForm()}</section>}
        </div>
      )}
    </div>
  );
}

function RowActions({
  busy,
  confirming,
  onAddChild,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  busy: boolean;
  confirming: boolean;
  onAddChild?: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-destructive">确认删除？</span>
        <Button variant="ghost" size="sm" onClick={onCancelDelete} disabled={busy}>
          取消
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} loading={busy}>
          删除
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {onAddChild && (
        <Button variant="ghost" size="sm" onClick={onAddChild}>
          子分类
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onEdit}>
        编辑
      </Button>
      <Button variant="ghost" size="sm" onClick={onAskDelete}>
        删除
      </Button>
    </div>
  );
}
