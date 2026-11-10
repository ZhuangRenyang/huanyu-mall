/**
 * API 请求体 DTO（Store + Admin）
 * 来源：openapi.yaml components.schemas（请求体部分）
 */
import type { AttributeInput } from './admin';
import type { Money } from './common';

/**
 * 创建购物车。
 *
 * **不要传 region_id**：后端 `POST /store/carts` 的请求体只接受 email，
 * 区域与币种一律由 `x-publishable-key` 解析出的 channel 推导
 * （见 apps/api/src/routes/store/carts.ts 的 createCartBody）。
 * 之前这里把 region_id 标成必填，调用方只能凭空造一个用不上的值。
 */
export interface CreateCartRequest {
  email?: string | null;
}

/** 加购：只传 variant_id + quantity，价格与标题由后端解析（openapi AddLineItemRequest）。 */
export interface AddLineItemRequest {
  variant_id: string;
  quantity: number;
}

/** 修改行数量。 */
export interface UpdateLineItemRequest {
  quantity: number;
}

/** 选择运费方式。 */
export interface SetShippingMethodRequest {
  shipping_option_id: string;
}

/** 创建支付会话。 */
export interface CreatePaymentSessionRequest {
  cart_id: string;
  provider_id: string;
  /** 支付完成后的回跳地址（PayPal 必填：缺了用户付完款无处可去）。 */
  return_url?: string;
  /** 发起支付的设备：mobile（手机，支付宝走 wap.pay 唤起 App）/ desktop（PC）。 */
  device?: 'mobile' | 'desktop';
}

/** 顾客注册。 */
export interface RegisterRequest {
  email: string;
  password: string;
  first_name?: string | null;
  last_name?: string | null;
}

/** 登录（店面 / 后台通用）。 */
export interface LoginRequest {
  email: string;
  password: string;
}

/** 扣款（幂等键必填；金额默认取 payment 记录金额）。 */
export interface CapturePaymentRequest {
  amount_minor?: number;
  idempotency_key: string;
}

/**
 * 管理员自助改密。
 * 只传当前口令与新口令，不接受管理员 id（后端据此防越权改他人口令）。
 */
export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

/** 刷新 / 退出令牌。 */
export interface RefreshRequest {
  refresh_token: string;
}

/** 创建商品。 */
export interface CreateProductRequest {
  title: string;
  handle: string;
  subtitle?: string | null;
  description?: string | null;
  product_type_id?: string | null;
  attributes?: AttributeInput[];
  variants?: CreateVariantRequest[];
}

/** 更新商品。 */
export interface UpdateProductRequest {
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  status?: 'draft' | 'published' | 'archived';
}

/** 创建变体。 */
export interface CreateVariantRequest {
  sku: string;
  title: string;
  options?: Record<string, string>;
  weight_gram?: number | null;
  prices?: Money[];
}

/** 更新变体。 */
export interface UpdateVariantRequest {
  sku?: string;
  title?: string;
  status?: 'draft' | 'published' | 'archived';
}

/** 按币种批量设价。 */
export interface PutPricesRequest {
  prices: Money[];
}

/** 全额退款（一期只全额）。 */
export interface CreateRefundRequest {
  amount_minor: number;
  reason: string;
}

/** 创建发货单。 */
export interface CreateFulfillmentRequest {
  items: {
    order_line_item_id: string;
    quantity: number;
  }[];
}

/** 发货（手填承运商 + 单号）。 */
export interface CreateShipmentRequest {
  carrier_name: string;
  tracking_number: string;
}

/** 更新库存量（在库量）。 */
export interface UpdateInventoryLevelRequest {
  stocked_quantity: number;
}

/** 更新设置。 */
export interface UpdateSettingsRequest {
  site_name?: string;
}

/** 更新设计变量（换肤）。 */
export interface UpdateThemeRequest {
  primary_color?: string;
  font_family?: string;
  border_radius?: string;
  product_image_ratio?: string;
}

/** 填写密钥并启用支付 Provider。 */
export interface UpdatePaymentProviderRequest {
  is_enabled: boolean;
  options?: Record<string, string>;
}
