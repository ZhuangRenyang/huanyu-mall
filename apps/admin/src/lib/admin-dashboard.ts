/**
 * 后台工作台数据层（ADR-030）。
 *
 * 对齐淘宝「首页」与 Shopify Home：商家进门先看「今天做了多少生意、有多少事要处理」。
 *
 * 金额一律 minor unit（分）向前端传递，展示层只格式化、不做加减。
 */
import { adminClient, getAdminApiMode } from './admin-client';
import { listOrders as mockListOrders, listRefunds as mockListRefunds } from './admin-store';
import { listInventoryLevels } from './admin-inventory';

/** 默认预警阈值（与后端 LOW_STOCK_ALERT_THRESHOLD 同值；演示模式兜底用）。 */
const LOW_STOCK_THRESHOLD = 5;

export interface DashboardView {
  today: {
    paidOrders: number;
    paidAmountMinor: number;
    currencyCode: string;
  };
  pending: {
    /** 已付款但还没发完。 */
    toFulfill: number;
    /** 待处理退款单。 */
    refunds: number;
    /** 低库存规格数（ADR-074）；含已售罄。 */
    lowStock: number;
    /** 预警阈值，由后端下发，前端不自己抄数。 */
    lowStockThreshold: number;
  };
  recentOrders: Array<{
    id: string;
    status: string;
    paymentStatus: string;
    email: string;
    totalMinor: number;
    currencyCode: string;
    placedAt: string | null;
  }>;
}

interface ApiDashboard {
  today?: {
    paid_orders?: number;
    paid_amount_minor?: number;
    currency_code?: string;
  };
  pending?: {
    to_fulfill?: number;
    refunds?: number;
    low_stock?: number;
    low_stock_threshold?: number;
  };
  recent_orders?: Array<{
    id: string;
    status: string;
    payment_status: string;
    email: string;
    total_minor: number;
    currency_code: string;
    placed_at: string | null;
  }>;
}

/** 待发货口径与后端一致：付过款、且还没发完（mock 的履约状态里 shipped/delivered 算发完）。 */
const TO_FULFILL_PAYMENT = new Set(['paid', 'partially_paid', 'authorized']);
const SHIPPED = new Set(['shipped', 'delivered']);

export async function getDashboard(): Promise<DashboardView> {
  if (getAdminApiMode() !== 'live') {
    // mock：拿本地种子订单现算，口径与后端一致（只算今天、只算已付款）
    const orders = mockListOrders();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const paidToday = orders.filter(
      (o) => o.paymentStatus === 'paid' && new Date(o.createdAt) >= today,
    );
    const refunds = mockListRefunds().filter((r) => r.status === 'pending');
    return {
      today: {
        paidOrders: paidToday.length,
        paidAmountMinor: paidToday.reduce((sum, o) => sum + o.totalMinor, 0),
        currencyCode: paidToday[0]?.currency ?? 'CNY',
      },
      pending: {
        toFulfill: orders.filter(
          (o) => TO_FULFILL_PAYMENT.has(o.paymentStatus) && !SHIPPED.has(o.fulfillmentStatus),
        ).length,
        refunds: refunds.length,
        // 演示模式按同一口径现算：可用量 ≤5 的规格（多仓去重）
        lowStock: await (async () => {
          const levels = await listInventoryLevels(undefined, LOW_STOCK_THRESHOLD);
          return new Set(levels.map((l) => l.inventoryItemId)).size;
        })(),
        lowStockThreshold: LOW_STOCK_THRESHOLD,
      },
      recentOrders: orders.slice(0, 5).map((o) => ({
        id: o.id,
        status: o.fulfillmentStatus,
        paymentStatus: o.paymentStatus,
        email: o.customerEmail,
        totalMinor: o.totalMinor,
        currencyCode: o.currency,
        placedAt: o.createdAt,
      })),
    };
  }

  const res = (await adminClient().getDashboard()) as ApiDashboard;
  return {
    today: {
      paidOrders: res.today?.paid_orders ?? 0,
      paidAmountMinor: res.today?.paid_amount_minor ?? 0,
      currencyCode: res.today?.currency_code ?? 'CNY',
    },
    pending: {
      toFulfill: res.pending?.to_fulfill ?? 0,
      refunds: res.pending?.refunds ?? 0,
      lowStock: res.pending?.low_stock ?? 0,
      lowStockThreshold: res.pending?.low_stock_threshold ?? LOW_STOCK_THRESHOLD,
    },
    recentOrders: (res.recent_orders ?? []).map((o) => ({
      id: o.id,
      status: o.status,
      paymentStatus: o.payment_status,
      email: o.email,
      totalMinor: o.total_minor,
      currencyCode: o.currency_code,
      placedAt: o.placed_at,
    })),
  };
}
