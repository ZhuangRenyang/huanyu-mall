import { defineLink, type LinkDefinition } from "@mall/core";

/**
 * 跨模块关联声明（架构 §4.3）。关联表无 REFERENCES、无业务字段；
 * 删除语义：restrict（默认）/ dismiss（调用方显式）/ cascade（仅 1:1 且登记理由）。
 */

/** N:N，restrict；关系属性 is_visible/sort_order（product ↔ channel）。 */
export const productChannelLink: LinkDefinition = defineLink({
  table: "product_channel",
  left: { module: "product", table: "product", field: "product_id" },
  right: { module: "region-channel", table: "channel", field: "channel_id" },
  cardinality: "N:N",
  onDelete: "restrict",
  columns: [
    { name: "is_visible", type: "boolean", default: true },
    { name: "sort_order", type: "integer", default: 0 },
  ],
  uniqueKeys: [["product_id", "channel_id"]],
});

/** N:1，dismiss（删变体时 workflow 显式 dismiss，price_set 保留）（product_variant ↔ price_set）。 */
export const variantPriceSetLink: LinkDefinition = defineLink({
  table: "variant_price_set",
  left: { module: "product", table: "product_variant", field: "variant_id" },
  right: { module: "pricing", table: "price_set", field: "price_set_id" },
  cardinality: "N:1",
  onDelete: "dismiss",
  uniqueKeys: [["variant_id"]],
});

/** N:N，restrict（price_list ↔ channel）。 */
export const priceListChannelLink: LinkDefinition = defineLink({
  table: "price_list_channel",
  left: { module: "pricing", table: "price_list", field: "price_list_id" },
  right: { module: "region-channel", table: "channel", field: "channel_id" },
  cardinality: "N:N",
  onDelete: "restrict",
  uniqueKeys: [["price_list_id", "channel_id"]],
});

/** 1:1，dismiss（inventory_item ↔ product_variant；删变体时 workflow 显式 dismiss）。 */
export const inventoryItemVariantLink: LinkDefinition = defineLink({
  table: "inventory_item_variant",
  left: { module: "inventory", table: "inventory_item", field: "inventory_item_id" },
  right: { module: "product", table: "product_variant", field: "variant_id" },
  cardinality: "1:1",
  onDelete: "dismiss",
  uniqueKeys: [["inventory_item_id"], ["variant_id"]],
});

/** N:N，restrict（stock_location ↔ channel）。 */
export const stockLocationChannelLink: LinkDefinition = defineLink({
  table: "stock_location_channel",
  left: { module: "inventory", table: "stock_location", field: "stock_location_id" },
  right: { module: "region-channel", table: "channel", field: "channel_id" },
  cardinality: "N:N",
  onDelete: "restrict",
  uniqueKeys: [["stock_location_id", "channel_id"]],
});

/** N:1，dismiss（cart ↔ customer；游客车无此行）。 */
export const cartCustomerLink: LinkDefinition = defineLink({
  table: "cart_customer",
  left: { module: "cart", table: "cart", field: "cart_id" },
  right: { module: "customer", table: "customer", field: "customer_id" },
  cardinality: "N:1",
  onDelete: "dismiss",
  uniqueKeys: [["cart_id"]],
});

/** N:1，restrict（order ↔ customer；有订单的客户禁止硬删）。 */
export const orderCustomerLink: LinkDefinition = defineLink({
  table: "order_customer",
  left: { module: "order", table: "order", field: "order_id" },
  right: { module: "customer", table: "customer", field: "customer_id" },
  cardinality: "N:1",
  onDelete: "restrict",
  uniqueKeys: [["order_id"]],
});

/** 1:1，cascade（order ↔ payment_collection；仅订单从未支付成功时允许级联）。 */
export const orderPaymentCollectionLink: LinkDefinition = defineLink({
  table: "order_payment_collection",
  left: { module: "order", table: "order", field: "order_id" },
  right: { module: "payment", table: "payment_collection", field: "payment_collection_id" },
  cardinality: "1:1",
  onDelete: "cascade",
  uniqueKeys: [["order_id"]],
});

/** 1:N，cascade（order → fulfillment；仅未支付成功时级联，一个订单可拆多个包裹）。 */
export const orderFulfillmentLink: LinkDefinition = defineLink({
  table: "order_fulfillment",
  left: { module: "order", table: "order", field: "order_id" },
  right: { module: "fulfillment", table: "fulfillment", field: "fulfillment_id" },
  cardinality: "1:N",
  onDelete: "cascade",
  uniqueKeys: [["fulfillment_id"]],
});

/** N:1，restrict（tax_rate ↔ channel；一期一渠道一税率，unique channel_id）。 */
export const taxRateChannelLink: LinkDefinition = defineLink({
  table: "tax_rate_channel",
  left: { module: "tax", table: "tax_rate", field: "tax_rate_id" },
  right: { module: "region-channel", table: "channel", field: "channel_id" },
  cardinality: "N:1",
  onDelete: "restrict",
  uniqueKeys: [["channel_id"]],
});

/** N:N，restrict（shipping_option ↔ channel；运费方案按渠道启用）。 */
export const shippingOptionChannelLink: LinkDefinition = defineLink({
  table: "shipping_option_channel",
  left: { module: "fulfillment", table: "shipping_option", field: "shipping_option_id" },
  right: { module: "region-channel", table: "channel", field: "channel_id" },
  cardinality: "N:N",
  onDelete: "restrict",
  uniqueKeys: [["shipping_option_id", "channel_id"]],
});

/** N:N，restrict（payment_provider_config ↔ channel；支付方式按渠道启用，is_enabled/sort_order）。 */
export const paymentProviderChannelLink: LinkDefinition = defineLink({
  table: "payment_provider_channel",
  left: { module: "payment", table: "payment_provider_config", field: "provider_config_id" },
  right: { module: "region-channel", table: "channel", field: "channel_id" },
  cardinality: "N:N",
  onDelete: "restrict",
  columns: [
    { name: "is_enabled", type: "boolean", default: false },
    { name: "sort_order", type: "integer", default: 0 },
  ],
  uniqueKeys: [["provider_config_id", "channel_id"]],
});

/** N:1，dismiss（product_image ↔ file；删图时先删 file 再 dismiss）。 */
export const productImageFileLink: LinkDefinition = defineLink({
  table: "product_image_file",
  left: { module: "product", table: "product_image", field: "product_image_id" },
  right: { module: "file", table: "file", field: "file_id" },
  cardinality: "N:1",
  onDelete: "dismiss",
  uniqueKeys: [["product_image_id"]],
});

export const allLinks: LinkDefinition[] = [
  productChannelLink,
  variantPriceSetLink,
  priceListChannelLink,
  inventoryItemVariantLink,
  stockLocationChannelLink,
  cartCustomerLink,
  orderCustomerLink,
  orderPaymentCollectionLink,
  orderFulfillmentLink,
  taxRateChannelLink,
  shippingOptionChannelLink,
  paymentProviderChannelLink,
  productImageFileLink,
];
