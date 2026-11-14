/**
 * 后台客户管理数据层（对齐淘宝「客户运营 → 客户列表」/ Shopify「Customers」）。
 *
 * 注册与登录在**店面**完成，这里只读：客户资料、地址、订单与消费。
 * 后台不提供代客注册、代客改密这类入口 —— 成熟系统都没有，属于自创功能。
 *
 * mock 模式：客户由本地订单的邮箱聚合出来（有订单才有客户，和真实系统一致）；
 * live：`GET /admin/customers` 与服务端分页，订单数与消费额由后端 GROUP BY 算好。
 */
import { adminClient, getAdminApiMode } from './admin-client';
import { listOrders as mockListOrders } from './admin-store';

export interface CustomerAddressView {
  id: string;
  name: string;
  phone: string;
  region: string;
  line1: string;
  isDefault: boolean;
}

/** 客户详情里的订单摘要（只取列表要显示的字段）。 */
export interface CustomerOrderView {
  id: string;
  status: string;
  totalMinor: number;
  currencyCode: string;
  createdAt: string;
  /** 商品标题，逗号拼接。 */
  itemsText: string;
  itemCount: number;
}

export interface CustomerView {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  /** 已付款且未退款的订单数（与后端统计口径一致）。 */
  orderCount: number;
  totalSpentMinor: number;
  lastOrderAt: string | null;
  /** 会员标签（ADR-103）。 */
  tags?: Array<{ id: string; name: string }>;
  addresses?: CustomerAddressView[];
  orders?: CustomerOrderView[];
}

export interface CustomerListQuery {
  q?: string;
  /** 按标签筛选（ADR-103）。 */
  tagId?: string;
  limit?: number;
  offset?: number;
}

export interface CustomerListResult {
  items: CustomerView[];
  total: number;
}

/** 展示名：有姓名用姓名，没有就用邮箱前缀（和订单列表一致）。 */
export function customerName(c: Pick<CustomerView, 'firstName' | 'lastName' | 'email'>): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ');
  return full || (c.email ? c.email.split('@')[0]! : '游客');
}

// ---------------------------------------------------------------- *
// mock：从订单聚合客户
// ---------------------------------------------------------------- *

function mockCustomers(): CustomerView[] {
  const orders = mockListOrders();
  const byEmail = new Map<string, CustomerView & { lastAt: number }>();
  for (const o of orders) {
    const email = o.customerEmail || 'guest@example.com';
    const existing = byEmail.get(email);
    // 与后端口径一致：已退款/取消的不计入消费
    const counts = o.paymentStatus === 'paid';
    const next = existing ?? {
      id: `cus_${email.replace(/[^a-z0-9]/gi, '_')}`,
      email,
      firstName: null,
      lastName: o.customerName || null,
      phone: null,
      orderCount: 0,
      totalSpentMinor: 0,
      lastOrderAt: null,
      lastAt: 0,
    };
    if (counts) {
      next.orderCount += 1;
      next.totalSpentMinor += o.totalMinor;
    }
    const at = o.createdAt ? Date.parse(o.createdAt) : 0;
    if (at > next.lastAt) {
      next.lastAt = at;
      next.lastOrderAt = o.createdAt || null;
    }
    byEmail.set(email, next);
  }
  return [...byEmail.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .map(({ lastAt: _lastAt, ...rest }) => rest);
}

// ---------------------------------------------------------------- *
// live 映射
// ---------------------------------------------------------------- *

function mapCustomer(raw: Record<string, unknown>): CustomerView {
  return {
    id: String(raw.id ?? ''),
    email: String(raw.email ?? ''),
    firstName: (raw.first_name as string | null) ?? null,
    lastName: (raw.last_name as string | null) ?? null,
    phone: (raw.phone as string | null) ?? null,
    orderCount: Number(raw.order_count ?? 0),
    totalSpentMinor: Number(raw.total_spent_minor ?? 0),
    lastOrderAt: (raw.last_order_at as string | null) ?? null,
    tags: Array.isArray(raw.tags)
      ? (raw.tags as Array<{ id?: string; name?: string }>).map((t) => ({
          id: String(t.id ?? ''),
          name: String(t.name ?? ''),
        }))
      : [],
  };
}

function mapAddress(raw: Record<string, unknown>): CustomerAddressView {
  const name = [raw.first_name, raw.last_name].filter(Boolean).join(' ');
  const region = [raw.province, raw.city].filter(Boolean).join(' ');
  return {
    id: String(raw.id ?? ''),
    name: name || '—',
    phone: (raw.phone as string | null) ?? '—',
    region: region || '—',
    line1: String(raw.line1 ?? '—'),
    isDefault: raw.is_default_shipping === true,
  };
}

function mapOrder(raw: Record<string, unknown>): CustomerOrderView {
  const lines = (raw.line_items as Array<Record<string, unknown>> | undefined) ?? [];
  const titles = lines.map((l) => String(l.title ?? ''));
  return {
    id: String(raw.id ?? ''),
    status: String(raw.status ?? ''),
    totalMinor: Number(raw.total_minor ?? 0),
    currencyCode: String(raw.currency_code ?? 'CNY'),
    createdAt: String(raw.placed_at ?? ''),
    itemsText: titles.join('、'),
    itemCount: lines.reduce((n, l) => n + Number(l.quantity ?? 0), 0),
  };
}

// ---------------------------------------------------------------- *
// 查询
// ---------------------------------------------------------------- *

export async function listCustomers(q: CustomerListQuery = {}): Promise<CustomerListResult> {
  if (getAdminApiMode() !== 'live') {
    let all = mockCustomers();
    const needle = q.q?.trim().toLowerCase();
    if (needle) {
      all = all.filter(
        (c) =>
          c.email.toLowerCase().includes(needle) ||
          `${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase().includes(needle),
      );
    }
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 20;
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
  const res = (await adminClient().listCustomers({
    limit: q.limit ?? 20,
    offset: q.offset ?? 0,
    ...(q.q ? { q: q.q } : {}),
    ...(q.tagId ? { tag_id: q.tagId } : {}),
  })) as { items?: Array<Record<string, unknown>>; count?: number };
  return {
    items: (res.items ?? []).map(mapCustomer),
    total: res.count ?? 0,
  };
}

export async function getCustomer(id: string): Promise<CustomerView | null> {
  if (getAdminApiMode() !== 'live') {
    const found = mockCustomers().find((c) => c.id === id);
    if (!found) return null;
    const orders = mockListOrders()
      .filter((o) => (o.customerEmail || 'guest@example.com') === found.email)
      .map((o) => ({
        id: o.id,
        status: o.paymentStatus,
        totalMinor: o.totalMinor,
        currencyCode: o.currency,
        createdAt: o.createdAt,
        itemsText: o.items.map((i) => i.title).join('、'),
        itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      }));
    return { ...found, addresses: [], orders };
  }
  const raw = (await adminClient().getCustomer(id)) as Record<string, unknown>;
  return {
    ...mapCustomer(raw),
    addresses: ((raw.addresses as Array<Record<string, unknown>> | undefined) ?? []).map(
      mapAddress,
    ),
    orders: ((raw.orders as Array<Record<string, unknown>> | undefined) ?? []).map(mapOrder),
  };
}
