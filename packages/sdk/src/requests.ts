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

/** 设置优惠券码（覆盖式；只传码凭证，折扣金额由后端 computeDiscounts 算，铁律 13）。 */
export interface SetVoucherCodesRequest {
  codes: string[];
}

/** 设置礼品卡码（覆盖式；只传卡码凭证，抵扣金额由后端 computeDiscounts 算，铁律 13）。 */
export interface SetGiftCardCodesRequest {
  codes: string[];
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
  /** 运费模板；null = 默认模板。 */
  shipping_profile_id?: string | null;
  /** 卖家包邮：该商品不产生运费。 */
  free_shipping?: boolean;
  /** 所属分类（可多选，对应淘宝发布页的「商品分类」）。 */
  category_ids?: string[];
  attributes?: AttributeInput[];
  variants?: CreateVariantRequest[];
}

/** 更新商品。 */
export interface UpdateProductRequest {
  title?: string;
  shipping_profile_id?: string | null;
  free_shipping?: boolean;
  subtitle?: string | null;
  description?: string | null;
  status?: 'draft' | 'published' | 'archived';
  /** 整组替换分类关联（不传 = 不动；空数组 = 清空）。 */
  category_ids?: string[];
}

/** 商品分类（ADR-028）。 */
export interface CreateCategoryRequest {
  name: string;
  handle?: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface UpdateCategoryRequest {
  name?: string;
  handle?: string;
  parent_id?: string | null;
  sort_order?: number;
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
/**
 * 发起退款申请（商家主动）。
 *
 * 不含金额：金额由服务端按订单实付取（铁律 13），客户端传金额等于给「退多退少」开口子。
 * 提交后进入「退款管理 → 待处理」，审核通过才真正打款。
 */
export interface CreateRefundRequest {
  reason: string;
}

/** 创建发货单（一张发货单只发一个仓；reservation_ids 必须是该仓预留的子集）。 */
export interface CreateFulfillmentRequest {
  items: {
    order_line_item_id: string;
    quantity: number;
  }[];
  stock_location_id?: string;
  reservation_ids?: string[];
}

/** 发货（手填承运商 + 单号）。 */
export interface CreateShipmentRequest {
  carrier_name: string;
  tracking_number: string;
}

/** 更新库存量（在库量）。 */
/** 手工调整库存：相对增量（正=入库，负=出库），后端校验不得低于已预留。 */
export interface UpdateInventoryLevelRequest {
  delta: number;
  reason?: string;
}

// —— 多仓（ADR-013）：仓库 / 按仓库存行 / 调拨 ——

/** 创建仓库。priority 大者优先（分配时先扣高优先级仓）。 */
export interface CreateStockLocationRequest {
  name: string;
  priority?: number;
}

/** 更新仓库；priority 语义同创建（大者优先）。 */
export interface UpdateStockLocationRequest {
  name?: string;
  priority?: number;
}

/** 创建调拨单（pending 只登记，不占量；complete 时才搬货）。 */
export interface CreateInventoryTransferRequest {
  inventory_item_id: string;
  from_location_id: string;
  to_location_id: string;
  quantity: number;
  note?: string;
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

// —— 促销（后台管理，阶段 6）——
// 金额一律 minor unit（分）；percentage 为万分比 bps（2000 = 20%）。

/** 创建优惠券。 */
export interface CreateVoucherRequest {
  name: string;
  type?: 'entire_order' | 'shipping' | 'specific_product';
  discount_type: 'fixed' | 'percentage';
  discount_value: number;
  min_spent?: number | null;
  usage_limit?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  /** 管理员指定券码；不传则后端生成 1 个高熵码。 */
  codes?: string[];
}

/** 更新优惠券。 */
export interface UpdateVoucherRequest {
  name?: string;
  type?: 'entire_order' | 'shipping' | 'specific_product';
  discount_type?: 'fixed' | 'percentage';
  discount_value?: number;
  min_spent?: number | null;
  usage_limit?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

/** 追加券码（一券多码）。 */
export interface AddVoucherCodesRequest {
  codes: string[];
}

/** 创建礼品卡（卡码由后端生成，初始余额为正整数 minor unit）。 */
export interface CreateGiftCardRequest {
  currency: string;
  initial_balance: number;
  expires_at?: string | null;
  assigned_to?: string | null;
}

/** 更新礼品卡（只允许改有效期与绑定客户，余额走调账）。 */
export interface UpdateGiftCardRequest {
  expires_at?: string | null;
  assigned_to?: string | null;
}

/** 手动调账：正=加余额，负=减余额（minor unit）。 */
export interface AdjustGiftCardRequest {
  delta_minor: number;
  reason?: string;
}

/**
 * 促销条件谓词（ADR-012 §2）：and/or 组合 + 叶子条件。
 * 金额一律 minor unit；空对象 `{}` 视为不命中，因此最小条件也要显式给一条。
 */
export type PromotionPredicateInput =
  | { and: PromotionPredicateInput[] }
  | { or: PromotionPredicateInput[] }
  | { variantIds: string[] }
  | { categoryIds: string[] }
  | { collectionIds: string[] }
  | { subtotalGte: number }
  | { currencyEq: string };

/** 促销规则（条件 + 动作）。percentage 为万分比 bps（2000=20%），fixed 为 minor unit。 */
export interface PromotionRuleInput {
  predicate?: PromotionPredicateInput;
  reward_type: 'fixed' | 'percentage';
  reward_value: number;
  allocation?: 'each' | 'across' | 'once' | null;
}

/** 创建促销（目录促销 catalogue / 订单促销 order），可同时附带规则。 */
export interface CreatePromotionRequest {
  name: string;
  code?: string | null;
  type: 'catalogue' | 'order';
  status?: 'draft' | 'active' | 'inactive';
  is_automatic?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  usage_limit?: number | null;
  metadata?: Record<string, unknown> | null;
  rules?: PromotionRuleInput[];
}

/** 更新促销（规则走 addPromotionRule / deletePromotionRule 单独维护）。 */
export interface UpdatePromotionRequest {
  name?: string;
  code?: string | null;
  type?: 'catalogue' | 'order';
  status?: 'draft' | 'active' | 'inactive';
  is_automatic?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  usage_limit?: number | null;
  metadata?: Record<string, unknown> | null;
}
