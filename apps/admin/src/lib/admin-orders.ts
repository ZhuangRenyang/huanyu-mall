import type { AdminOrder, AdminOrderLine } from './admin-data';
import { adminClient, getAdminApiMode } from './admin-client';
import {
  listOrders as mockListOrders,
  listShippedLocations,
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
    o.status === 'completed' ? 'delivered' : o.status === 'fulfilled' ? 'shipped' : 'unfulfilled';
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
  };
}

export async function listOrders(): Promise<AdminOrder[]> {
  if (getAdminApiMode() !== 'live') return mockListOrders();
  const res = (await adminClient().listOrders({ limit: 100 })) as { items?: ApiOrder[] };
  return (res.items ?? []).map(mapOrder);
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

export async function refundOrder(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = mockListOrders();
    const o = list.find((x) => x.id === id);
    if (o) o.paymentStatus = 'refunded';
    return;
  }
  const client = adminClient();
  const order = (await client.getOrder(id)) as ApiOrder;
  await client.refundOrder(id, {
    amount_minor: order.total_minor,
    reason: '后台发起全额退款',
  });
}
