import type { OrderFulfillment, OrderPayment } from './admin-data';

export const PAY_META: Record<OrderPayment, { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  paid: { label: '已支付', variant: 'success' },
  pending: { label: '待支付', variant: 'warning' },
  refunded: { label: '已退款', variant: 'neutral' },
};

export const FUL_META: Record<OrderFulfillment, { label: string; variant: 'warning' | 'info' | 'success' }> = {
  unfulfilled: { label: '待发货', variant: 'warning' },
  shipped: { label: '已发货', variant: 'info' },
  delivered: { label: '已完成', variant: 'success' },
};
