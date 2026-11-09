import type { AdminOrder, AdminOrderLine } from './admin-data';
import { adminClient, getAdminApiMode } from './admin-client';
import { listOrders as mockListOrders } from './admin-store';

/**
 * 订单域：列表 / 详情 / 发货 / 退款。
 *
 * 后端字段（snake_case）→ 界面视图模型（camelCase）的映射只在这里发生。
 */

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

export async function shipOrder(id: string, carrier: string, trackingNumber: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = mockListOrders();
    const o = list.find((x) => x.id === id);
    if (o) {
      o.fulfillmentStatus = 'shipped';
      o.carrier = carrier;
      o.trackingNumber = trackingNumber;
    }
    return;
  }
  const client = adminClient();
  const order = (await client.getOrder(id)) as ApiOrder;
  const items = (order.line_items ?? []).map((li) => ({
    order_line_item_id: li.id ?? '',
    quantity: li.quantity,
  }));
  const fulfillment = (await client.createFulfillment(order.id, { items })) as { id: string };
  await client.createShipment(fulfillment.id, { carrier_name: carrier, tracking_number: trackingNumber });
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
