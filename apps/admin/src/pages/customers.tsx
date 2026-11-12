import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Mail, MapPin, Phone, Search, Users } from 'lucide-react';
import {
  Badge,
  Button,
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
  const demo = getAdminApiMode() !== 'live';

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await listCustomers({
        q: applied || undefined,
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
  }, [applied, page]);

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
    </div>
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
