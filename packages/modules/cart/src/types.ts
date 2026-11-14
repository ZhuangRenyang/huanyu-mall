/** M04 Cart DTO 与契约（对齐架构 §2.1）。游客车 customer_id 为 null（cart_customer 无行）。 */

export type CartStatus = "open" | "completed" | "abandoned";

export interface CartTotals {
  subtotal_minor: bigint;
  shipping_minor: bigint;
  /** 商品行税额 + 运费税额（展示口径）。 */
  tax_minor: bigint;
  /**
   * 其中的「运费税额」。
   * 单独留一份是给下单用的：订单只从商品行拿税，必须再补上运费的税，
   * 否则购物车显示 2678、订单只收 2574（少收钱，且展示与实收不一致）。
   */
  shipping_tax_minor: bigint;
  total_minor: bigint;
  discount_minor: bigint;
}

export interface CartLineItemDTO {
  id: string;
  cart_id: string;
  variant_id: string;
  product_id: string;
  title: string;
  quantity: number;
  unit_price_minor: bigint;
  currency_code: string;
  /** 目录促销行级折扣（minor unit），读时动态算（retrieveCart），落库行恒 0。 */
  discount_minor: bigint;
  /** 本行适用税率（bps）与税额（minor unit），读时按收货国家动态算。 */
  tax_rate_bps: number;
  tax_amount_minor: bigint;
}

export interface CartShippingMethodDTO {
  id: string;
  cart_id: string;
  shipping_option_id: string;
  name: string;
  amount_minor: bigint;
  currency_code: string;
}

/** 命中的促销折扣明细（读时动态算），供下单侧固化进 order_discount 留痕（ADR-012 §3）。 */
export interface CartDiscountDTO {
  type: "catalogue" | "order" | "voucher" | "gift_card" | "points";
  promotion_id: string;
  code: string | null;
  amount_minor: bigint;
}

export interface CartDTO {
  id: string;
  channel_id: string;
  region_id: string;
  currency_code: string;
  customer_id: string | null;
  email: string | null;
  status: CartStatus;
  /** 收货国家（ISO 两位大写）：税与运费的唯一口径来源；null = 还没填地址。 */
  shipping_country: string | null;
  /** 顾客输入的 voucher 码（持久化，刷新不丢），读时传给 computeDiscounts 算折扣。 */
  voucher_codes: string[];
  /** 顾客输入的 gift card 码（持久化，刷新不丢），读时传给 computeDiscounts 算抵扣。 */
  gift_card_codes: string[];
  /** 顾客想用的积分数（ADR-094）。 */
  points_to_use: bigint;
  totals: CartTotals | null;
}

export interface CartDetailDTO extends CartDTO {
  items: CartLineItemDTO[];
  shipping_method: CartShippingMethodDTO | null;
  /** 命中的促销折扣明细（目录行级 + 订单级），供下单固化 order_discount 留痕。 */
  discounts: CartDiscountDTO[];
  /** 税是否已含在价格里：true 时合计不再加税（ADR-018）。 */
  tax_included_in_price: boolean;
}

export interface CreateCartInput {
  channelId: string;
  regionId: string;
  currencyCode: string;
  customerId?: string | null;
  email?: string | null;
}

/** 加购入参：**只收 variantId + quantity**。价格/标题一律后端解析（铁律 13，防客户端篡改价格）。 */
export interface AddLineItemInput {
  variantId: string;
  quantity: number;
}

/** 后端解析后的完整行项（价格/标题只信后端）。 */
export interface ResolvedLineItem extends AddLineItemInput {
  productId: string;
  title: string;
  sku: string;
  unitPriceMinor: bigint;
  currencyCode: string;
}

/** 商品查询端口：解析变体 → 商品 id / 标题 / sku。 */
export interface ProductLookupPort {
  listVariantsByIds(
    ids: string[],
  ): Promise<Array<{ id: string; product_id: string; sku: string; title: string; status: string }>>;
  /** 批量查「商品 → 分类」映射（供目录促销算折扣）。 */
  listCategoryIdsByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; categoryIds: string[] }>>;
  /**
   * 批量查商品的运费归属（运费模板 + 是否卖家包邮）。
   *
   * 运费跟着商品走：不同商品可挂不同模板，也可以卖家包邮。
   * 结账据此分组算运费，不能全店一套价（淘宝/Shopify 同做法）。
   */
  listShippingInfoByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; profileId: string | null; freeShipping: boolean }>>;
}

/** 定价端口：按币种/渠道/数量算价（唯一计价入口）。 */
export interface PricingLookupPort {
  calculatePrices(input: {
    variantIds: string[];
    context: { currencyCode: string; channelId?: string; quantity?: number };
  }): Promise<Array<{ variantId: string; amountMinor: bigint; currencyCode: string }>>;
}

/** Cart 模块依赖：repo + 商品/定价/运费/促销查询端口（跨模块走端口，架构 §2）。 */
/** 税务查询端口（跨模块走端口）：按国家算税，金额服务端算（铁律 13）。 */
export interface TaxLookupPort {
  calculateTax(input: {
    countryCode?: string | null;
    lines: Array<{ lineId: string; amountMinor: bigint }>;
    shippingMinor: bigint;
  }): Promise<{
    lines: Array<{ lineId: string; taxRateBps: number; taxAmountMinor: bigint }>;
    totalTaxMinor: bigint;
    /** 其中运费的税（下单必须一并收，见 CartTotals.shipping_tax_minor）。 */
    shippingTaxMinor: bigint;
    rateSource: "country" | "default" | "none";
    /** 含税价时合计不再加税（见 TaxResultDTO）。 */
    included_in_price: boolean;
  }>;
}

export interface CartServiceDeps {
  repo: CartRepository;
  product: ProductLookupPort;
  pricing: PricingLookupPort;
  shipping: ShippingLookupPort;
  promotion: PromotionLookupPort;
  tax: TaxLookupPort;
}

/** 促销查询端口（跨模块走端口，M-promotion）：算目录促销行级折扣（金额服务端算，客户端永不传价）。 */
export interface PromotionLookupPort {
  computeDiscounts(ctx: {
    currencyCode: string;
    customerId?: string | null;
    items: Array<{
      id: string;
      variantId: string;
      categoryIds: string[];
      quantity: number;
      unitPriceMinor: bigint;
    }>;
    subtotalMinor: bigint;
    shippingMinor: bigint;
    voucherCodes: string[];
    giftCardCodes: string[];
    /** 顾客想用的积分数（ADR-094）。 */
    pointsToUse?: bigint;
  }): Promise<{
    lineAdjustments: Array<{ itemId: string; amountMinor: bigint; promotionId: string; code: string }>;
    orderDiscountMinor: bigint;
    orderDiscounts: Array<{ promotionId: string; code: string | null; amountMinor: bigint }>;
    voucherDiscountMinor: bigint;
    voucherDiscounts: Array<{ promotionId: string; code: string; amountMinor: bigint }>;
    giftCardAppliedMinor: bigint;
    giftCardDiscounts: Array<{ giftCardId: string; code: string; amountMinor: bigint }>;
    /** 积分抵扣金额（ADR-094）。 */
    pointsAppliedMinor: bigint;
    pointsUsed: bigint;
  }>;
}

/** 选运费：只传方案 id，方案名与运费由后端解析（铁律 13，防客户端指定运费）。 */
export interface SetShippingInput {
  shippingOptionId: string;
}

/** 落库的运费方式（name/amountMinor 由后端解析后传入）。 */
export interface ShippingMethodInput {
  shippingOptionId: string;
  name: string;
  amountMinor: bigint;
}

/** 运费方案查询端口（跨模块走端口，M08 fulfillment）。 */
export interface ShippingLookupPort {
  /** 按渠道 + 国家 + 模板列可用运费方案（自动选最便宜的那个）。 */
  listShippingOptions(input: {
    channelId: string;
    countryCode: string;
    cartSubtotalMinor: bigint;
    /** 商品的运费模板；null = 默认模板。 */
    profileId?: string | null;
  }): Promise<Array<{ id: string; name: string }>>;
  findShippingOption(
    id: string,
  ): Promise<{ id: string; name: string; amount_minor: bigint } | null>;
  /**
   * 按购物车小计算运费规则价（如 free_over 满额免运费）。
   * 选运费时**必须走这里**，而不是用方案基础价 amount_minor ——
   * 否则「满额免运费」这类规则永远不生效，展示价与实收价会不一致。
   */
  calculateShippingPrice(
    optionId: string,
    ctx: { cartSubtotalMinor: bigint },
  ): Promise<{ amountMinor: bigint; currencyCode: string }>;
}

export interface CartRepository {
  insert(input: CreateCartInput & { id: string }): Promise<CartDTO>;
  findById(id: string): Promise<CartDTO | null>;
  updateStatus(id: string, status: CartStatus): Promise<void>;
  /** 持久化收货国家（ISO 两位大写）。 */
  updateShippingCountry(id: string, countryCode: string): Promise<void>;
  /** 持久化顾客输入的 voucher codes（jsonb string[]）。 */
  updateVoucherCodes(id: string, codes: string[]): Promise<void>;
  /** 持久化顾客输入的 gift card codes（jsonb string[]）。 */
  updateGiftCardCodes(id: string, codes: string[]): Promise<void>;
  /** 设置积分抵扣意愿（ADR-094）。 */
  updatePointsToUse(id: string, points: bigint): Promise<void>;
  softDelete(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  listLineItems(cartId: string): Promise<CartLineItemDTO[]>;
  findLineItem(lineId: string): Promise<CartLineItemDTO | null>;
  insertLineItem(cartId: string, input: ResolvedLineItem): Promise<CartLineItemDTO>;
  updateLineItemQuantity(lineId: string, quantity: number): Promise<void>;
  softDeleteLineItem(lineId: string): Promise<void>;
  upsertShippingMethod(
    cartId: string,
    input: ShippingMethodInput & { currencyCode: string },
  ): Promise<void>;
  findShippingMethod(cartId: string): Promise<CartShippingMethodDTO | null>;
  linkCustomer(cartId: string, customerId: string): Promise<void>;
}

export interface ICartModuleService {
  createCart(input: CreateCartInput): Promise<CartDTO>;
  /** 合计一律读购物车上的收货国家（ADR-019），不再接受调用方传国家。 */
  retrieveCart(id: string): Promise<CartDetailDTO>;
  /** 设置收货国家，并按该国自动重算运费与税（ADR-019）。 */
  setShippingCountry(cartId: string, countryCode: string): Promise<CartDetailDTO>;
  addLineItem(cartId: string, input: AddLineItemInput): Promise<CartDetailDTO>;
  updateLineItem(cartId: string, lineId: string, patch: { quantity: number }): Promise<CartDetailDTO>;
  deleteLineItem(cartId: string, lineId: string): Promise<void>;
  setShippingMethod(cartId: string, input: SetShippingInput): Promise<CartDetailDTO>;
  /** 设置顾客输入的 voucher codes（覆盖式；只传凭证，金额由后端算）。 */
  setVoucherCodes(cartId: string, codes: string[]): Promise<CartDetailDTO>;
  /** 设置顾客输入的 gift card codes（覆盖式；只传凭证，抵扣由后端算）。 */
  setGiftCardCodes(cartId: string, codes: string[]): Promise<CartDetailDTO>;
  /** 设置积分抵扣意愿（ADR-094）：只存点数，抵扣额由 promotion 折算封顶。 */
  setPointsToUse(cartId: string, points: bigint): Promise<CartDetailDTO>;
  completeCart(cartId: string): Promise<void>;
  restoreCart(cartId: string): Promise<void>;
}
