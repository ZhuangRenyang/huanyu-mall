import type { OrderDetailDTO } from "@mall/order";

export function mapOrder(order: OrderDetailDTO) {
  return {
    id: order.id,
    status: order.status,
    payment_status: order.payment_status,
    email: order.email,
    currency_code: order.currency_code,
    subtotal_minor: order.subtotal_minor,
    shipping_minor: order.shipping_minor,
    tax_minor: order.tax_minor,
    discount_minor: order.discount_minor,
    total_minor: order.total_minor,
    shipping_address: order.shipping_address,
    line_items: order.items.map((li) => ({
      id: li.id,
      variant_id: li.variant_id,
      title: li.title,
      sku: li.sku,
      quantity: li.quantity,
      unit_price_minor: li.unit_price_minor,
      tax_rate_bps: li.tax_rate_bps,
      tax_amount_minor: li.tax_amount_minor,
      total_minor: li.total_minor,
      currency_code: li.currency_code,
    })),
    placed_at: order.placed_at,
  };
}
