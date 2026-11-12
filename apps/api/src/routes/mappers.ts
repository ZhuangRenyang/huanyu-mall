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

/**
 * 后台订单视图：在门店视图基础上加「折扣留痕明细」（order_discount 表）。
 * 资金安全硬约束 5：后台必须能追溯「这笔折扣是哪个促销 / 哪张券 / 哪张卡给的」。
 * 只给后台，不进门店契约（门店只需要金额，不需要促销内部 id）。
 */
export function mapAdminOrder(order: OrderDetailDTO) {
  return {
    ...mapOrder(order),
    /** 商家备注只在后台出现，店面接口不带（mapOrder 不含此字段）。 */
    merchant_note: order.merchant_note,
    discounts: (order.discounts ?? []).map((d) => ({
      type: d.type,
      promotion_id: d.promotion_id,
      code: d.code,
      amount_minor: d.amount_minor,
    })),
  };
}
