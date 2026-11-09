/**
 * 全球商城 · Store / Admin API 共享 DTO（来自 openapi.yaml）
 * -----------------------------------------------------------------------------
 * 店面（apps/storefront）与后台共用。金额一律 `*_minor`（最小币种单位）。
 * 注意：后端以 bigint 存储金额；JSON 传输为 number，一期真实金额远小于
 * Number.MAX_SAFE_INTEGER，前端仅做展示（换算见 @mall/ui 的 formatMoney）。
 */

// 信封 / 分页类型复用 @mall/types（单一事实来源，避免重复定义）。
export type { Envelope, PaginatedResponse } from '@mall/types';

/** 错误响应体（code 见 ARCHITECTURE §7.4）。 */
export interface ErrorResponse {
  code: number;
  data: Record<string, unknown> | null;
  message: string;
}

/** 金额（统一最小单位）。 */
export interface Money {
  amount_minor: number;
  currency_code: string;
}

export type ProductStatus = 'draft' | 'published' | 'archived';
export type VariantStatus = 'draft' | 'published' | 'archived';
export type InventoryStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type OrderStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'paid'
  | 'fulfilled'
  | 'completed'
  | 'canceled'
  | 'refunded';
export type PaymentStatus = 'unpaid' | 'authorized' | 'captured' | 'refunded';
export type AuthScope = 'customer' | 'admin';

/** 认证令牌对（access 15 分钟 + refresh 轮换）。 */
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: AuthScope;
}

/** 收货地址。 */
export interface Address {
  id: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  province?: string | null;
  postal_code: string;
  country_code: string;
  is_default_shipping?: boolean;
}

/** 主题 / 设计变量（换肤可调项）。 */
export interface ThemeSettings {
  primary_color?: string;
  font_family?: string;
  border_radius?: string;
  shadow?: string;
  product_image_ratio?: string;
}

/** 店铺设置。 */
export interface Settings {
  site_name?: string;
  channel_slug?: string;
  default_locale?: string;
  currency_code?: string;
}
