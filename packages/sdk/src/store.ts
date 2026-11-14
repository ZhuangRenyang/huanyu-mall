/**
 * Store API DTO（店面公开接口，x-publishable-key 解析 channel）
 * 来源：openapi.yaml components.schemas（store 部分）
 */
import type {
  Address,
  InventoryStatus,
  Money,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  VariantStatus,
} from './common';

/** 商品列表项。 */
export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  subtitle?: string | null;
  thumbnail_url?: string | null;
  status: ProductStatus;
  price?: Money;
}

/** 商品图。 */
export interface ProductImage {
  id: string;
  url: string;
  alt?: string | null;
  is_primary?: boolean;
}

/** 变体摘要（含库存状态）。 */
export interface VariantSummary {
  id: string;
  title: string;
  sku: string;
  status: VariantStatus;
  price?: Money;
  inventory_status?: InventoryStatus;
  available_quantity?: number;
}

/** 商品属性（如 颜色=黑色）。 */
export interface ProductAttribute {
  name: string;
  value: string;
}

/** 商品详情。 */
export interface ProductDetail {
  id: string;
  title: string;
  handle: string;
  subtitle?: string | null;
  description?: string | null;
  status: ProductStatus;
  images?: ProductImage[];
  variants: VariantSummary[];
  attributes?: ProductAttribute[];
}

/** 分类。 */
export interface Category {
  id: string;
  name: string;
  handle: string;
  parent_id?: string | null;
}

/** 购物车行。 */
export interface CartLineItem {
  id: string;
  variant_id: string;
  product_id?: string;
  title: string;
  quantity: number;
  unit_price_minor: number;
  currency_code: string;
  line_total_minor?: number;
  /**
   * 该行还能不能买（ADR-062）。
   * delisted = 商品已下架；out_of_stock = 已售罄；insufficient = 库存不足。
   * 老后端不返回时按 ok 处理。
   */
  availability_status?: "ok" | "insufficient" | "out_of_stock" | "delisted";
  /** 该变体当前可用量（不含已预留）。 */
  available_quantity?: number;
}

/** 购物车运费方式。 */
export interface CartShippingMethod {
  id: string;
  shipping_option_id?: string;
  name: string;
  amount_minor: number;
  currency_code: string;
}

/** 购物车金额合计。 */
export interface CartTotals {
  subtotal_minor: number;
  shipping_minor: number;
  tax_minor: number;
  discount_minor?: number;
  total_minor: number;
}

/** 命中的促销折扣明细（voucher / gift card / 目录 / 订单，金额由后端算）。 */
export interface CartDiscount {
  type: 'catalogue' | 'order' | 'voucher' | 'gift_card' | 'points';
  promotion_id: string;
  code: string | null;
  amount_minor: number;
}

/** 购物车。 */
export interface Cart {
  id: string;
  channel_id: string;
  region_id?: string;
  currency_code: string;
  customer_id?: string | null;
  email?: string | null;
  status: 'open' | 'completed' | 'abandoned';
  /** 顾客输入的 voucher 码（后端持久化，刷新不丢）。 */
  voucher_codes?: string[];
  /** 顾客输入的 gift card 码（后端持久化，刷新不丢）。 */
  gift_card_codes?: string[];
  /** 顾客想用的积分数（ADR-094）。 */
  points_to_use?: number;
  line_items: CartLineItem[];
  shipping_method?: CartShippingMethod;
  totals: CartTotals;
  /** 税是否已含在价格里（true 时 totals.total_minor 不再额外加税）。 */
  tax_included_in_price?: boolean;
  /** 折扣明细（后端现阶段未在 mapCart 透出，预留契约，前端按缺省降级为单条「优惠」合计）。 */
  discounts?: CartDiscount[];
}

/** 结账可选国家/地区（含实际生效税率）。 */
export interface CheckoutCountry {
  code: string;
  name: string;
  tax_rate_bps: number;
  rate_source: 'country' | 'default' | 'none';
}

/** 下单随附的收货地址（后端存单 + 按其中的国家解析税率，ADR-018）。 */
export interface ShippingAddressInput {
  name?: string;
  phone?: string;
  country?: string;
  province?: string;
  city?: string;
  address_1?: string;
  address_2?: string;
  postal_code?: string;
}

/** 可选运费方式。 */
export interface ShippingOption {
  id: string;
  name: string;
  type?: 'flat' | 'weight_based' | 'free_over';
  amount_minor: number;
  currency_code: string;
}

/** 支付方式选项。 */
export interface PaymentProviderOption {
  id: string;
  provider_id: string;
  label: string;
}

/** 支付会话（context 为客户端拉起支付所需）。 */
export interface PaymentSession {
  id: string;
  provider_id: string;
  status:
    | 'pending'
    | 'requires_more'
    | 'authorized'
    | 'captured'
    | 'failed'
    | 'canceled'
    | 'expired';
  amount_minor: number;
  currency_code: string;
  context?: {
    kind?: 'qrcode' | 'redirectUrl' | 'clientSecret';
    qrcode?: string | null;
    redirectUrl?: string | null;
    clientSecret?: string | null;
  } | null;
}

/** 订单行（含快照）。 */
export interface OrderLineItem {
  id: string;
  /** 商品 id：评价按它提交。 */
  product_id?: string;
  variant_id?: string;
  title: string;
  sku: string;
  quantity: number;
  unit_price_minor: number;
  tax_rate_bps?: number;
  tax_amount_minor?: number;
  total_minor: number;
  currency_code: string;
}

/** 收货地址快照。 */
export interface OrderShippingAddress {
  first_name: string;
  last_name: string;
  line1: string;
  city: string;
  postal_code: string;
  country_code: string;
  phone?: string;
}

/** 订单。 */
export interface Order {
  id: string;
  status: OrderStatus;
  payment_status?: PaymentStatus;
  email: string;
  currency_code: string;
  subtotal_minor: number;
  shipping_minor: number;
  tax_minor: number;
  discount_minor?: number;
  total_minor: number;
  shipping_address?: OrderShippingAddress;
  line_items: OrderLineItem[];
  placed_at?: string;
  /** 配送方式（详情接口返回；列表不查，避免 N+1）。 */
  shipping_method?: {
    name: string;
    carrier_name: string | null;
    amount_minor: number;
    currency_code: string;
  } | null;
  /** 支付渠道（详情接口返回）。未付款或货到付款为 null。 */
  payment_provider?: { id: string; label: string } | null;
  /** 已提交过评价的商品 id（「我的订单」显示「已评价」）。 */
  reviewed_product_ids?: string[];
  /**
   * 顾客下单留言（淘宝「给卖家留言」）。
   * 顾客自己与商家都能看到；后台的 merchant_note 只给商家看，别混（ADR-050）。
   */
  customer_note?: string | null;
  /** 发货单（含物流单号）：顾客端「物流信息」用它（ADR-033）。 */
  fulfillments?: Array<{
    id: string;
    status: string;
    tracking_links: Array<{ carrier: string; number: string }>;
  }>;
}

/** 顾客。 */
export interface Customer {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

/** 顾客详情（含地址簿）。 */
export interface CustomerDetail extends Customer {
  addresses?: Address[];
}

/** bootstrap 返回体。 */
export interface BootstrapData {
  channel: string;
  locale: string;
  currency_code: string;
  theme: {
    primary_color?: string;
    font_family?: string;
    border_radius?: string;
    shadow?: string;
    product_image_ratio?: string;
  };
}
