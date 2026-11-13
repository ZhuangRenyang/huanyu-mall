/**
 * 订单查询数据层（mock）：合并 checkout 产生的 sessionStorage 订单 + 示例历史订单。
 * 真实接入后替换为 GET /store/orders 与 GET /store/orders/{id}。
 */
import { getApiMode, getStoreClient } from './api';
import type { OrderLineSnapshot, OrderRecord } from './checkout';

export type OrderStatusKey =
  | 'awaiting_payment'
  | 'to_ship'
  | 'to_receive'
  | 'completed'
  /** 已申请退款，商家审核中（淘宝的「退款中」）。 */
  | 'refund_pending'
  | 'refunded'
  /** 已取消/已关闭（未付款取消、支付失败关闭）。 */
  | 'canceled';

export type OrderBadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'info';

export const ORDER_STATUS_META: Record<OrderStatusKey, { label: string; variant: OrderBadgeVariant }> = {
  awaiting_payment: { label: '待付款', variant: 'warning' },
  to_ship: { label: '待发货', variant: 'brand' },
  to_receive: { label: '待收货', variant: 'info' },
  completed: { label: '已完成', variant: 'success' },
  refund_pending: { label: '退款中', variant: 'warning' },
  refunded: { label: '已退款', variant: 'neutral' },
  canceled: { label: '已关闭', variant: 'neutral' },
};

export type TimelineKey = 'placed' | 'paid' | 'shipped' | 'delivered';
export interface TimelineItem {
  key: TimelineKey;
  label: string;
  at?: number;
}

export interface OrderView {
  id: string;
  status: OrderStatusKey;
  createdAt: number;
  currencyCode: string;
  items: OrderLineSnapshot[];
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  shippingOptionName: string;
  paymentMethod: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  shippingRegion: string;
  shippingLine1: string;
  tracking?: { carrier: string; number: string };
  /** 已提交过评价的商品 id（「评价」按钮变「已评价」）。 */
  reviewedProductIds?: string[];
  /** 下单时写的「给卖家留言」（ADR-050）。 */
  customerNote?: string;
  timeline: TimelineItem[];
}

const HOUR = 3600_000;
const CURRENCY = 'CNY';
const LABELS: Record<TimelineKey, string> = { placed: '已下单', paid: '已付款', shipped: '已发货', delivered: '已签收' };

function buildTimeline(status: OrderStatusKey, createdAt: number): TimelineItem[] {
  const at = (h: number) => createdAt + h * HOUR;
  return [
    { key: 'placed', label: LABELS.placed, at: createdAt },
    { key: 'paid', label: LABELS.paid, at: status === 'awaiting_payment' ? undefined : at(0.05) },
    { key: 'shipped', label: LABELS.shipped, at: status === 'to_receive' || status === 'completed' ? at(26) : undefined },
    { key: 'delivered', label: LABELS.delivered, at: status === 'completed' ? at(74) : undefined },
  ];
}

function recordToView(rec: OrderRecord): OrderView {
  const status: OrderStatusKey =
    rec.status === 'paid'
      ? 'to_ship'
      : rec.status === 'shipped'
        ? 'to_receive'
        : rec.status === 'delivered'
          ? 'completed'
          : rec.status === 'refund_pending'
            ? 'refund_pending'
            : rec.status === 'refunded'
              ? 'refunded'
              : rec.status === 'canceled' || rec.status === 'failed'
                ? 'canceled'
                : 'awaiting_payment';
  return {
    id: rec.id,
    status,
    createdAt: rec.createdAt,
    currencyCode: rec.currencyCode,
    items: rec.items,
    subtotalMinor: rec.subtotalMinor,
    shippingMinor: rec.shippingMinor,
    taxMinor: rec.taxMinor,
    totalMinor: rec.totalMinor,
    shippingOptionName: rec.shippingOptionName,
    paymentMethod: rec.paymentMethod ?? '在线支付',
    contactName: rec.contactName ?? '访客',
    contactPhone: rec.phone,
    contactEmail: rec.email || undefined,
    shippingRegion: rec.shippingRegion ?? '—',
    shippingLine1: rec.shippingLine1 ?? '—',
    reviewedProductIds: rec.reviewedProductIds ?? [],
    ...(rec.customerNote ? { customerNote: rec.customerNote } : {}),
    timeline: buildTimeline(status, rec.createdAt),
  };
}

function seedOrder(opts: {
  id: string;
  status: OrderStatusKey;
  daysAgo: number;
  items: OrderLineSnapshot[];
  contactName: string;
  phone: string;
  email: string;
  region: string;
  line1: string;
  tracking?: { carrier: string; number: string };
  /** 给卖家留言（示例数据里带一条，方便看到这块长什么样）。 */
  customerNote?: string;
}): OrderView {
  const createdAt = Date.now() - opts.daysAgo * 24 * HOUR;
  const subtotalMinor = opts.items.reduce((s, i) => s + i.unitPriceMinor * i.quantity, 0);
  return {
    id: opts.id,
    status: opts.status,
    createdAt,
    currencyCode: CURRENCY,
    items: opts.items,
    subtotalMinor,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: subtotalMinor,
    shippingOptionName: '标准跨境专线',
    paymentMethod: '微信支付',
    contactName: opts.contactName,
    contactPhone: opts.phone,
    contactEmail: opts.email,
    shippingRegion: opts.region,
    shippingLine1: opts.line1,
    tracking: opts.tracking,
    ...(opts.customerNote ? { customerNote: opts.customerNote } : {}),
    timeline: buildTimeline(opts.status, createdAt),
  };
}

function seedOrders(): OrderView[] {
  return [
    seedOrder({
      id: 'ord_sample_7f3k',
      status: 'to_receive',
      daysAgo: 3,
      items: [{ title: '主动降噪头戴耳机', variantTitle: '曜石黑', quantity: 1, unitPriceMinor: 89900, imageUrl: 'https://picsum.photos/seed/headphones/200/250' }],
      contactName: '林知远',
      phone: '13800001234',
      email: 'lin@example.com',
      region: '广东省深圳市南山区',
      line1: '科技园科苑路 15 号',
      tracking: { carrier: '顺丰国际', number: 'SF1234567890' },
      customerNote: '工作日白天送，别放快递柜',
    }),
    seedOrder({
      id: 'ord_sample_2m9q',
      status: 'completed',
      daysAgo: 12,
      items: [{ title: '87 键机械键盘', variantTitle: '茶轴', quantity: 1, unitPriceMinor: 52900, imageUrl: 'https://picsum.photos/seed/keyboard/200/250' }],
      contactName: '陈苇',
      phone: '13900004567',
      email: 'chen@example.com',
      region: '上海市浦东新区',
      line1: '张江高科祖冲之路 88 号',
      tracking: { carrier: 'DHL', number: 'DH9876543210' },
    }),
    seedOrder({
      id: 'ord_sample_5x1v',
      status: 'refunded',
      daysAgo: 20,
      items: [{ title: '20000mAh 快充充电宝', variantTitle: '远峰蓝', quantity: 1, unitPriceMinor: 14900, imageUrl: 'https://picsum.photos/seed/powerbank/200/250' }],
      contactName: '赵一鸣',
      phone: '13700007890',
      email: 'zhao@example.com',
      region: '北京市海淀区',
      line1: '中关村大街 1 号',
    }),
  ];
}

function readSessionOrders(): OrderRecord[] {
  const out: OrderRecord[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('order:')) {
        const raw = sessionStorage.getItem(key);
        if (raw) out.push(JSON.parse(raw) as OrderRecord);
      }
    }
  } catch {
    /* sessionStorage 不可用 */
  }
  return out;
}

/**
 * 演示模式的「已确认收货」覆盖表。
 *
 * 示例订单是常量，直接把 status 改在内存里刷新就丢；写 sessionStorage 才能让
 * 「确认收货 → 状态变已完成 → 出现评价入口」这条链在演示里完整走一遍。
 */
const STATUS_OVERRIDE_KEY = 'order:status-override';

function readStatusOverrides(): Record<string, OrderStatusKey> {
  try {
    const raw = sessionStorage.getItem(STATUS_OVERRIDE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, OrderStatusKey>) : {};
  } catch {
    return {};
  }
}

function writeStatusOverride(orderId: string, status: OrderStatusKey): void {
  try {
    const all = readStatusOverrides();
    all[orderId] = status;
    sessionStorage.setItem(STATUS_OVERRIDE_KEY, JSON.stringify(all));
  } catch {
    /* noop */
  }
}

/** 全部订单（真实下单 + 示例），按下单时间倒序；演示覆盖表生效。 */
export function listOrders(): OrderView[] {
  const overrides = readStatusOverrides();
  return [...readSessionOrders().map(recordToView), ...seedOrders()]
    .map((o) => {
      const status = overrides[o.id];
      // 状态变了，时间线也要跟着重建，否则会出现「已完成但时间线停在已发货」
      return status && status !== o.status
        ? { ...o, status, timeline: buildTimeline(status, o.createdAt) }
        : o;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 确认收货（淘宝「确认收货」）。
 *
 * 服务端只允许 fulfilled / delivered → completed；前端确认框是体验，
 * 真正的状态校验在状态机里。
 */
export async function confirmReceipt(orderId: string): Promise<void> {
  if (getApiMode() !== 'live') {
    writeStatusOverride(orderId, 'completed');
    return;
  }
  await getStoreClient().confirmOrderReceipt(orderId);
}

export function findOrder(id: string): OrderView | null {
  if (!id) return null;
  return listOrders().find((o) => o.id === id) ?? null;
}

/** 订单记录 → 列表/详情视图（mock 与 live 共用）。 */
export function orderRecordToView(rec: OrderRecord): OrderView {
  return recordToView(rec);
}

/** 游客查单：单号 + 手机后四位 / 邮箱。 */
export function findOrderByIdentity(orderId: string, identity: string): { order?: OrderView; error?: string } {
  const order = findOrder(orderId);
  if (!order) return { error: '未找到该订单号，请核对后重试' };
  const key = identity.trim().toLowerCase();
  const phoneTail = order.contactPhone.slice(-4);
  const email = (order.contactEmail ?? '').toLowerCase();
  if (key === phoneTail || (email && key === email)) return { order };
  return { error: '单号与手机后四位 / 邮箱不匹配' };
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
