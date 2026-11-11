/**
 * Admin API DTO（后台接口，admin JWT + RBAC）
 * 来源：openapi.yaml components.schemas（admin 部分）
 */
import type { Money, ProductStatus, VariantStatus } from './common';

/** 属性定义（product type 层）。 */
export interface AttributeInput {
  name: string;
  handle: string;
  input_type: 'dropdown' | 'multiselect' | 'swatch' | 'boolean' | 'numeric' | 'text';
  values?: string[];
  is_filterable?: boolean;
}

/** 变体（字段级）。 */
export interface AdminVariant {
  id: string;
  sku: string;
  title: string;
  status: VariantStatus;
  options?: Record<string, string>;
  prices?: Money[];
}

/** 商品（字段级）。 */
export interface AdminProduct {
  id: string;
  title: string;
  handle: string;
  subtitle?: string | null;
  description?: string | null;
  status: ProductStatus;
  product_type?: string | null;
  variants?: AdminVariant[];
}

/** 发货件。 */
export interface Shipment {
  id: string;
  carrier_name: string;
  tracking_number: string;
  shipped_at?: string;
}

/** 履约单。 */
export interface Fulfillment {
  id: string;
  order_id?: string;
  /** 所属仓（ADR-013 §3）：一张发货单只发一个仓；历史数据为 null。 */
  stock_location_id?: string | null;
  status: 'not_fulfilled' | 'fulfilled' | 'shipped' | 'delivered' | 'canceled';
  shipments?: Shipment[];
}

/** 退款。 */
export interface Refund {
  id: string;
  amount_minor: number;
  currency_code: string;
  reason?: string | null;
  status: 'pending' | 'succeeded' | 'failed';
}

/** 库存项。 */
export interface InventoryItem {
  id: string;
  sku: string;
  title?: string | null;
  requires_shipping?: boolean;
}

/** 库存量。 */
export interface InventoryLevel {
  id: string;
  inventory_item_id: string;
  stock_location_id: string;
  stocked_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
}

/** 按仓库存行（仓 × SKU，带 sku 便于后台展示）。 */
export interface InventoryLevelRow extends InventoryLevel {
  sku: string;
}

/** 仓库。priority 大者优先（分配时先扣高优先级仓）。 */
export interface StockLocation {
  id: string;
  name: string;
  priority: number;
}

/** 邮件通知配置（ADR-016）。密码只存标记，永不回显。 */
export interface AdminNotificationSettings {
  enabled: boolean;
  from_name: string;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password_set: boolean;
  order_confirmation_enabled: boolean;
  shipment_enabled: boolean;
  storefront_url: string;
}

export interface AdminNotification {
  id: string;
  template: "order_confirmation" | "shipment_notification";
  to_email: string;
  subject: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  error: string | null;
  order_id: string | null;
  created_at: string;
  sent_at: string | null;
}

/** 营销功能级开关（默认全关，后台各页面独立打开）。 */
export interface MarketingFeatureFlags {
  promotion: boolean;
  voucher: boolean;
  gift_card: boolean;
}

/** 发货计划：某个仓要发的订单行与数量（后端按预留算好）。 */
export interface FulfillmentPlan {
  stock_location_id: string;
  total_quantity: number;
  items: Array<{ order_line_item_id: string; quantity: number }>;
}

/** 发货单（后台）：一张只对应一个仓（ADR-013 §3）。 */
export interface AdminFulfillment {
  id: string;
  order_id: string;
  stock_location_id: string | null;
  status: string;
  reservation_ids: string[];
  tracking_links: Array<{ carrier: string; number: string }> | null;
}

/** 仓间调拨流水。pending 只登记不占量；completed 才搬货。 */
export interface InventoryTransfer {
  id: string;
  inventory_item_id: string;
  /** 物料 SKU（列表接口 join 出来；单查可能为 null）。 */
  sku: string | null;
  from_location_id: string;
  to_location_id: string;
  quantity: number;
  status: 'pending' | 'completed' | 'cancelled';
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** 文件信息。 */
export interface FileInfo {
  id: string;
  url: string;
  content_type?: string;
  size_bytes?: number;
}

/**
 * 管理员改密结果。
 * 改密成功后该管理员的全部 refresh_token 被撤销（reauth_required = true），
 * 调用方必须清掉本地会话并引导用户重新登录，不能沿用旧 token 继续操作。
 */
export interface ChangePasswordResponse {
  changed: boolean;
  revoked_refresh_tokens: number;
  reauth_required: boolean;
  message: string;
}

/** 支付 Provider 配置（读回打码）。 */
export interface PaymentProviderConfig {
  id: string;
  provider_id: string;
  is_enabled: boolean;
}

/** 优惠券（后台列表/详情）。 */
export interface AdminVoucher {
  id: string;
  name: string;
  type: 'entire_order' | 'shipping' | 'specific_product';
  usage_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  discount_type: 'fixed' | 'percentage';
  discount_value: number;
  min_spent: number | null;
  status: 'active' | 'disabled';
}

/** 券码（一券多码）。 */
export interface AdminVoucherCode {
  id: string;
  voucher_id: string;
  code: string;
  used: number;
  is_active: boolean;
}

/** 礼品卡。 */
export interface AdminGiftCard {
  id: string;
  code: string;
  currency: string;
  initial_balance: number;
  current_balance: number;
  is_active: boolean;
  expires_at: string | null;
  assigned_to: string | null;
}

/** 礼品卡流水。 */
export interface AdminGiftCardEvent {
  id: string;
  gift_card_id: string;
  type: string;
  amount: number;
  order_id: string | null;
  parameters: Record<string, unknown> | null;
  created_at: string;
}

/** 促销规则（后台视图）：predicate 为类型化 JSON，reward_value 为 bps 或 minor unit。 */
export interface AdminPromotionRule {
  id: string;
  promotion_id: string;
  predicate: Record<string, unknown>;
  reward_type: 'fixed' | 'percentage';
  reward_value: number;
  allocation: 'each' | 'across' | 'once' | null;
}

/** 目录促销 / 订单促销（后台视图）。 */
export interface AdminPromotion {
  id: string;
  name: string;
  code: string | null;
  type: 'catalogue' | 'order';
  status: 'draft' | 'active' | 'inactive';
  is_automatic: boolean;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  used: number;
  metadata: Record<string, unknown> | null;
}
