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
