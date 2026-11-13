import type { AdminOrder, AdminOrderLine, AdminOrderLog } from './admin-data';
import { adminClient, getAdminApiMode } from './admin-client';
import {
  listOrders as mockListOrders,
  listShippedLocations,
  requestRefund as mockRequestRefund,
  setOrderNote as mockSetOrderNote,
  shipOrder as mockShipOrder,
} from './admin-store';
import { MOCK_BACKUP_LOCATION_ID, MOCK_MAIN_LOCATION_ID } from './admin-inventory';

/**
 * 订单域：列表 / 详情 / 按仓发货 / 退款。
 *
 * 后端字段（snake_case）→ 界面视图模型（camelCase）的映射只在这里发生。
 */

/** 订单预留明细（含仓）：按仓拆发货单前让操作员选仓（ADR-013 §3）。 */
export interface OrderReservationView {
  id: string;
  locationId: string;
  quantity: number;
}

export interface ShipOrderOptions {
  /** 发货仓；一张发货单只发一个仓。不传 = 单仓兼容路径。 */
  stockLocationId?: string;
  /** 本次要发的行项与数量；不传 = 该订单全部行项（原行为）。 */
  items?: Array<{ order_line_item_id: string; quantity: number }>;
}

interface ApiOrder {
  id: string;
  email: string;
  status: string;
  payment_status?: string;
  currency_code: string;
  subtotal_minor: number;
  shipping_minor: number;
  tax_minor: number;
  total_minor: number;
  placed_at?: string | null;
  shipping_address?: Record<string, unknown>;
  line_items?: Array<{
    id?: string;
    title: string;
    quantity: number;
    unit_price_minor: number;
    sku?: string;
  }>;
  shipping_method?: { carrier_name?: string | null; name?: string | null } | null;
  merchant_note?: string | null;
  /** 顾客留言（顾客与商家都能看到，ADR-050）。 */
  customer_note?: string | null;
}

function addressText(addr?: Record<string, unknown>): string {
  if (!addr) return '';
  const pick = (k: string) => (addr[k] == null ? '' : String(addr[k]));
  return [pick('name'), pick('phone'), pick('province'), pick('city'), pick('address1') ?? pick('address')]
    .filter(Boolean)
    .join(' · ');
}

function mapOrder(o: ApiOrder): AdminOrder {
  const payment: AdminOrder['paymentStatus'] =
    o.payment_status === 'refunded'
      ? 'refunded'
      : o.payment_status === 'captured' || o.payment_status === 'authorized'
        ? 'paid'
        : 'pending';
  const fulfillment: AdminOrder['fulfillmentStatus'] =
    o.status === 'completed'
      ? 'delivered'
      : o.status === 'fulfilled'
        ? 'shipped'
        : o.status === 'partially_fulfilled'
          ? 'partial'
          : 'unfulfilled';
  const items: AdminOrderLine[] = (o.line_items ?? []).map((li) => ({
    id: li.id,
    title: li.title,
    variantTitle: li.sku,
    quantity: li.quantity,
    unitPriceMinor: li.unit_price_minor,
  }));
  return {
    id: o.id,
    customerName: o.email ? o.email.split('@')[0] : '游客',
    customerEmail: o.email,
    createdAt: o.placed_at ?? '',
    paymentStatus: payment,
    fulfillmentStatus: fulfillment,
    currency: o.currency_code,
    subtotalMinor: o.subtotal_minor,
    shippingMinor: o.shipping_minor,
    taxMinor: o.tax_minor,
    totalMinor: o.total_minor,
    items,
    shippingAddress: addressText(o.shipping_address),
    carrier: o.shipping_method?.carrier_name ?? undefined,
    merchantNote: o.merchant_note ?? null,
    customerNote: o.customer_note ?? null,
    orderStatus: o.status,
  };
}

/** 写商家备注；传空串等于清空。 */
export async function setOrderNote(id: string, note: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSetOrderNote(id, note);
    return;
  }
  await adminClient().setOrderNote(id, { note: note.trim() === '' ? null : note.trim() });
}

/**
 * 订单操作日志。
 *
 * mock 模式没有真实审计流水，返回空数组并在界面提示「演示模式无日志」，
 * 不编造假数据 —— 假日志比没日志更坏。
 */
export async function listOrderLogs(id: string): Promise<AdminOrderLog[]> {
  if (getAdminApiMode() !== 'live') return [];
  const res = (await adminClient().listOrderLogs(id)) as {
    items?: Array<{
      id: string;
      action: string;
      actor?: string | null;
      created_at: string;
      before?: unknown;
      after?: unknown;
    }>;
  };
  return (res.items ?? []).map((r) => ({
    id: r.id,
    action: r.action,
    actor: r.actor ?? '系统',
    createdAt: r.created_at,
    before: r.before,
    after: r.after,
  }));
}

export interface OrderListParams {
  /** 状态集合（页签是多状态，如待发货 = paid + partially_fulfilled）。 */
  statuses?: string[];
  /** 订单号或顾客邮箱。 */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface OrderListResult {
  items: AdminOrder[];
  /** 满足筛选条件的总条数（服务端分页用）。 */
  total: number;
  /** 各状态计数（页签角标）；mock 模式下由本地订单现算。 */
  counts: Record<string, number>;
  hasMore: boolean;
}

/**
 * 订单列表：筛选、搜索与分页都在服务端。
 *
 * 之前是一次拉 100 条再本地筛 —— 订单一多就静默漏，而且工作台说「待发货 5」
 * 点进来可能是空列表（那 5 单不在前 100 条里）。
 */
export async function listOrders(params: OrderListParams = {}): Promise<OrderListResult> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  if (getAdminApiMode() !== 'live') {
    let all = mockListOrders();
    const counts: Record<string, number> = {};
    for (const o of all) {
      const key = o.orderStatus ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const wanted = params.statuses;
    if (wanted && wanted.length > 0) {
      all = all.filter((o) => wanted.includes(o.orderStatus ?? 'unknown'));
    }
    if (params.q) {
      const needle = params.q.toLowerCase();
      all = all.filter(
        (o) =>
          o.id.toLowerCase().includes(needle) ||
          o.customerEmail.toLowerCase().includes(needle),
      );
    }
    return {
      items: all.slice(offset, offset + limit),
      total: all.length,
      counts,
      hasMore: offset + limit < all.length,
    };
  }

  const query: Record<string, string | number> = { limit, offset };
  if (params.statuses && params.statuses.length > 0) query.status = params.statuses.join(',');
  if (params.q) query.q = params.q;
  const res = (await adminClient().listOrders(query)) as {
    items?: ApiOrder[];
    count?: number;
    counts?: Record<string, number>;
    hasMore?: boolean;
  };
  return {
    items: (res.items ?? []).map(mapOrder),
    total: res.count ?? 0,
    counts: res.counts ?? {},
    hasMore: res.hasMore === true,
  };
}

export async function getOrder(id: string): Promise<AdminOrder | null> {
  if (getAdminApiMode() !== 'live') {
    const list = mockListOrders();
    return list.find((o) => o.id === id) ?? null;
  }
  try {
    const o = (await adminClient().getOrder(id)) as ApiOrder;
    return mapOrder(o);
  } catch {
    return null;
  }
}

/** mock 预留：每个订单行轮流落到「主仓 / 备用仓」，让跨仓订单能演示按仓发货。 */
const MOCK_LOCATION_CYCLE = [MOCK_MAIN_LOCATION_ID, MOCK_BACKUP_LOCATION_ID] as const;

function mockReservations(orderId: string): OrderReservationView[] {
  const order = mockListOrders().find((o) => o.id === orderId);
  if (!order) return [];
  return order.items.map((line, i) => ({
    id: `resv_${orderId}_${i}`,
    locationId: MOCK_LOCATION_CYCLE[i % MOCK_LOCATION_CYCLE.length] ?? MOCK_MAIN_LOCATION_ID,
    quantity: line.quantity,
  }));
}

export async function listOrderReservations(orderId: string): Promise<OrderReservationView[]> {
  if (getAdminApiMode() !== 'live') return mockReservations(orderId);
  const res = (await adminClient().listOrderReservations(orderId)) as {
    items?: Array<{ id: string; stock_location_id: string; quantity: number }>;
  };
  return (res.items ?? []).map((r) => ({ id: r.id, locationId: r.stock_location_id, quantity: r.quantity }));
}

/**
 * 发货：先建发货单再录运单。
 *
 * - 不传 opts：沿用原行为（整单所有行项、由后端推断单仓），单仓店铺零改动。
 * - 传 opts：按指定仓建发货单（一张发货单不跨仓，ADR-013 §3）。
 */
export async function shipOrder(
  id: string,
  carrier: string,
  trackingNumber: string,
  opts?: ShipOrderOptions,
): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const locationCount = new Set(mockReservations(id).map((r) => r.locationId)).size;
    mockShipOrder(id, carrier, trackingNumber, {
      stockLocationId: opts?.stockLocationId,
      locationCount: locationCount || 1,
    });
    return;
  }
  const client = adminClient();
  let items = opts?.items;
  if (!items || items.length === 0) {
    const order = (await client.getOrder(id)) as ApiOrder;
    items = (order.line_items ?? []).map((li) => ({
      order_line_item_id: li.id ?? '',
      quantity: li.quantity,
    }));
  }
  const fulfillment = (await client.createFulfillment(id, {
    items,
    ...(opts?.stockLocationId ? { stock_location_id: opts.stockLocationId } : {}),
  })) as { id: string };
  await client.createShipment(fulfillment.id, { carrier_name: carrier, tracking_number: trackingNumber });
}

/** 发货计划：某个仓要发的订单行与数量（后端按预留算好，前端不再分行）。 */
export interface FulfillmentPlanView {
  locationId: string;
  totalQuantity: number;
  items: Array<{ lineId: string; quantity: number }>;
}

export async function getFulfillmentPlan(orderId: string): Promise<FulfillmentPlanView[]> {
  if (getAdminApiMode() !== 'live') {
    const order = mockListOrders().find((o) => o.id === orderId);
    if (!order) return [];
    const byLoc = new Map<string, Array<{ lineId: string; quantity: number }>>();
    mockReservations(orderId).forEach((r, i) => {
      const line = order.items[i];
      if (!line) return;
      const list = byLoc.get(r.locationId) ?? [];
      list.push({ lineId: line.id ?? `line_${i}`, quantity: line.quantity });
      byLoc.set(r.locationId, list);
    });
    return [...byLoc].map(([locationId, items]) => ({
      locationId,
      items,
      totalQuantity: items.reduce((n, i) => n + i.quantity, 0),
    }));
  }
  const res = (await adminClient().getOrderFulfillmentPlan(orderId)) as {
    plans?: Array<{
      stock_location_id: string;
      total_quantity: number;
      items: Array<{ order_line_item_id: string; quantity: number }>;
    }>;
  };
  return (res.plans ?? []).map((p) => ({
    locationId: p.stock_location_id,
    totalQuantity: p.total_quantity,
    items: p.items.map((i) => ({ lineId: i.order_line_item_id, quantity: i.quantity })),
  }));
}

/** 已发货的仓与运单（跨仓订单用它看「还差哪个仓没发」）。 */
export interface OrderFulfillmentView {
  id: string;
  locationId: string | null;
  status: string;
  carriers: Array<{ carrier: string; number: string }>;
}

export async function listOrderFulfillments(orderId: string): Promise<OrderFulfillmentView[]> {
  if (getAdminApiMode() !== 'live') {
    const locs = listShippedLocations(orderId);
    return locs.map((locationId, i) => ({
      id: `fulf_mock_${i}`,
      locationId,
      status: 'shipped',
      carriers: [],
    }));
  }
  const res = (await adminClient().listOrderFulfillments(orderId)) as {
    items?: Array<{
      id: string;
      stock_location_id: string | null;
      status: string;
      tracking_links?: Array<{ carrier: string; number: string }> | null;
    }>;
  };
  return (res.items ?? []).map((f) => ({
    id: f.id,
    locationId: f.stock_location_id,
    status: f.status,
    carriers: f.tracking_links ?? [],
  }));
}

/**
 * 商家在订单详情发起退款**申请**。
 *
 * 不直接打款：单据进「退款管理 → 待处理」，必须在那边审核通过才退钱。
 * 金额由服务端按订单实付取，前端不传。
 */
export async function requestOrderRefund(id: string, reason: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockRequestRefund(id, reason, 'merchant');
    return;
  }
  await adminClient().refundOrder(id, { reason });
}
