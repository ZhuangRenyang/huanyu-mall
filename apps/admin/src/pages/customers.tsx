import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Mail, MapPin, Phone, Search, Tag, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconButton,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  formatMoney,
} from '@mall/ui';
import { customerName, getCustomer, listCustomers, type CustomerView } from '@/lib/admin-customers';
import {
  createCustomerTag,
  deleteCustomerTag,
  getCustomerTagIds,
  listCustomerTags,
  setCustomerTags,
  type CustomerTagView,
} from '@/lib/admin-customer-tags';
import { getAdminApiMode } from '@/lib/admin-client';

/**
 * 客户列表（对齐淘宝「客户运营 → 客户列表」/ Shopify「Customers」）。
 *
 * 定位是**查看**：注册与登录在店面，后台不代客注册、不改密码。
 * 商家真正要看的是「这个人买了多少、最近什么时候买」，所以订单数与累计消费
 * 直接放在列表里，不用点进去才知道。
 *
 * 列表用服务端分页与搜索：客户上千之后前端过滤会漏。
 */
const PAGE_SIZE = 20;

export function CustomersPage() {
  const [items, setItems] = useState<CustomerView[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  /** 输入与真正发出去的搜索分开：避免每敲一个字打一次接口。 */
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomerView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** 会员标签（ADR-103）：筛选 + 打标共用一份。 */
  const [tags, setTags] = useState<CustomerTagView[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [tagging, setTagging] = useState<CustomerView | null>(null);
  const [managingTags, setManagingTags] = useState(false);
  const demo = getAdminApiMode() !== 'live';

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await listCustomers({
        q: applied || undefined,
        ...(tagFilter ? { tagId: tagFilter } : {}),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [applied, page, tagFilter]);

  const loadTags = useCallback(async () => {
    try {
      setTags(await listCustomerTags());
    } catch {
      // 标签拉失败不该挡住客户列表
    }
  }, []);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  useEffect(() => {
    void load();
  }, [load]);

  // 搜索防抖：输入停止 300ms 后才发请求并回到第一页
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const openDetail = async (c: CustomerView) => {
    setSelected(c);
    setDetailLoading(true);
    try {
      const full = await getCustomer(c.id);
      if (full) setSelected(full);
    } catch {
      // 详情拉失败时仍显示列表里的基础信息，不把抽屉关掉
    } finally {
      setDetailLoading(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">客户</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            顾客在店面临注册登录，这里可以查看资料、地址与购买记录。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            标签
            <select
              value={tagFilter}
              onChange={(e) => {
                setTagFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="">全部</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.customerCount}）
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" onClick={() => setManagingTags(true)}>
            <Tag className="size-4" strokeWidth={2} aria-hidden="true" />
            管理标签
          </Button>
        </div>
        <label className="relative block w-full max-w-xs">
          <span className="sr-only">搜索客户</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索邮箱或姓名"
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-ring"
          />
        </label>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {demo && (
        <p className="text-xs text-muted-foreground">
          演示模式下客户由本地订单聚合而来；接上后端后会显示真实注册顾客。
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={applied ? '没有匹配的客户' : '还没有客户'}
          description={
            applied ? '换个邮箱或姓名试试' : '顾客在店面临注册并下单后，会出现在这里'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">客户</th>
                <th scope="col" className="px-4 py-3 font-medium">联系方式</th>
                <th scope="col" className="px-4 py-3 font-medium">订单数</th>
                <th scope="col" className="px-4 py-3 font-medium">累计消费</th>
                <th scope="col" className="px-4 py-3 font-medium">标签</th>
                <th scope="col" className="px-4 py-3 font-medium">最近下单</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="transition-colors duration-150 hover:bg-muted/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-subtle text-xs font-medium text-primary-subtle-foreground"
                        aria-hidden="true"
                      >
                        {customerName(c).slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {customerName(c)}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {c.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.phone ?? '—'}
                  </td>
                  <td className="tabular px-4 py-3">{c.orderCount}</td>
                  <td className="tabular px-4 py-3">
                    {formatMoney(c.totalSpentMinor, 'CNY')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {(c.tags ?? []).map((t) => (
                        <Badge key={t.id} variant="brand">
                          {t.name}
                        </Badge>
                      ))}
                      <button
                        type="button"
                        onClick={() => setTagging(c)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {(c.tags ?? []).length === 0 ? '打标' : '编辑'}
                      </button>
                    </div>
                  </td>
                  <td className="tabular px-4 py-3 text-xs text-muted-foreground">
                    {c.lastOrderAt ? formatDate(c.lastOrderAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <IconButton
                        aria-label={`查看客户 ${c.email}`}
                        size="sm"
                        onClick={() => void openDetail(c)}
                      >
                        <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-xs text-muted-foreground">共 {total} 位客户</span>
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="tabular text-muted-foreground">
            {page} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected ? customerName(selected) : '客户'}</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-5">
            {selected && (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
                  <dl className="space-y-1.5 rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <Mail className="size-3.5" strokeWidth={2} aria-hidden="true" />
                        邮箱
                      </dt>
                      <dd className="truncate font-mono text-xs">{selected.email}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="size-3.5" strokeWidth={2} aria-hidden="true" />
                        手机
                      </dt>
                      <dd className="tabular">{selected.phone ?? '未填写'}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">客户 ID</dt>
                      <dd className="truncate font-mono text-xs text-muted-foreground">
                        {selected.id}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="grid grid-cols-3 gap-2">
                  <Stat label="订单数" value={String(selected.orderCount)} />
                  <Stat label="累计消费" value={formatMoney(selected.totalSpentMinor, 'CNY')} />
                  <Stat
                    label="最近下单"
                    value={selected.lastOrderAt ? formatDate(selected.lastOrderAt) : '—'}
                  />
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">收货地址</h3>
                  {detailLoading ? (
                    <p className="text-xs text-muted-foreground">正在读取…</p>
                  ) : (selected.addresses?.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      还没有保存的地址（结账时填写的地址只记在订单上）。
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selected.addresses!.map((a) => (
                        <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
                          <div className="flex items-center gap-2">
                            <MapPin
                              className="size-3.5 text-muted-foreground"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            <span className="font-medium text-foreground">{a.name}</span>
                            <span className="tabular text-xs text-muted-foreground">{a.phone}</span>
                            {a.isDefault && <Badge variant="neutral">默认</Badge>}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {a.region} {a.line1}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">最近订单</h3>
                  {detailLoading ? (
                    <p className="text-xs text-muted-foreground">正在读取…</p>
                  ) : (selected.orders?.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">还没有订单。</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {selected.orders!.map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <span className="block truncate font-mono text-xs text-foreground">
                              {o.id}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {o.itemsText || '—'} · {o.itemCount} 件
                            </span>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="tabular block text-sm">
                              {formatMoney(o.totalMinor, o.currencyCode)}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {o.createdAt ? formatDate(o.createdAt) : '—'}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">
                    全部订单请到「订单列表」按这个邮箱搜索。
                  </p>
                </section>
              </>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* 打标（ADR-103）：一个客户可以有多个标签 */}
      {tagging && (
        <TagCustomerDialog
          customer={tagging}
          tags={tags}
          onClose={() => setTagging(null)}
          onSaved={async () => {
            setTagging(null);
            await Promise.all([load(), loadTags()]);
          }}
        />
      )}

      {/* 标签管理：新建 / 删除（删除会同时清掉客户身上的关联） */}
      {managingTags && (
        <ManageTagsDialog
          tags={tags}
          onClose={() => setManagingTags(false)}
          onChanged={async () => {
            await loadTags();
          }}
        />
      )}
    </div>
  );
}

/** 给一个客户打标：勾选即保存（覆盖式）。 */
function TagCustomerDialog({
  customer,
  tags,
  onClose,
  onSaved,
}: {
  customer: CustomerView;
  tags: CustomerTagView[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCustomerTagIds(customer.id).then(setChecked);
  }, [customer.id]);

  const toggle = (id: string) => {
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setCustomerTags(customer.id, checked);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>客户标签</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {customerName(customer)} · {customer.email}
          </p>
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有标签，先在「管理标签」里建几个（如：高价值、待回购）。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {tags.map((t) => (
                <li key={t.id}>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={checked.includes(t.id)}
                      onChange={() => toggle(t.id)}
                      className="size-4 accent-primary"
                    />
                    {t.name}
                    <span className="text-xs text-muted-foreground">（{t.customerCount}）</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 标签管理：新建 + 删除。 */
function ManageTagsDialog({
  tags,
  onClose,
  onChanged,
}: {
  tags: CustomerTagView[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (name.trim() === '') return setError('请填写标签名称');
    setBusy(true);
    setError(null);
    try {
      await createCustomerTag(name.trim());
      setName('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '新建失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deleteCustomerTag(id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>管理标签</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs font-medium text-muted-foreground">
              新标签
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：高价值 / 待回购"
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <Button disabled={busy} onClick={() => void add()}>
              新建
            </Button>
          </div>
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有标签。</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {tags.map((t) => (
                <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-foreground">
                    {t.name}
                    <span className="ml-2 text-xs text-muted-foreground">{t.customerCount} 人</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(t.id)}
                    className="text-xs text-destructive hover:underline"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
