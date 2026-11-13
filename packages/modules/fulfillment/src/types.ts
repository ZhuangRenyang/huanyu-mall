/** M08 Fulfillment DTO 与契约（对齐架构 §2.1）。承运商 API 不接，发货手填。 */

export type ShippingOptionType = "flat" | "weight_based" | "free_over";
export type FulfillmentStatus = "not_fulfilled" | "fulfilled" | "shipped" | "delivered" | "canceled";

/**
 * 运费模板（对齐淘宝「运费模板」/ Shopify shipping profile）。
 *
 * 商品上架时选一个模板（或选「卖家包邮」）；运费按模板内的发货区与方式算。
 * 这样重货、冷链、特殊类目可以单独计费，而不必为了一个类目改全店运费。
 */
export interface ShippingProfileDTO {
  id: string;
  name: string;
  /** 默认模板：商品没指定模板时用它，且不可删除。 */
  is_default: boolean;
}

/**
 * 发货区（标准电商模型：Shopify / WooCommerce / Medusa 一致）。
 *
 * 运费永远按**收货国家**算，不按商品算；但每个区属于一个运费模板，
 * 所以同一个国家在不同模板里可以有不同的价格。
 * 同一模板内，一个区可含多个国家，且**同一国家只能属于一个区**。
 */
export interface ShippingZoneDTO {
  id: string;
  name: string;
  /** 所属模板；历史数据为 null 视同默认模板。 */
  profile_id: string | null;
  /** ISO 3166-1 alpha-2，大写。 */
  country_codes: string[];
}

/** 后台视角的运费方式：多一个满额包邮门槛，省得再查一次规则表。 */
export interface ShippingOptionDetailDTO extends ShippingOptionDTO {
  /** free_over 类型的免运费门槛（minor）；其它类型为 null。 */
  free_over_threshold_minor: bigint | null;
}

export interface CreateShippingZoneInput {
  name: string;
  countryCodes: string[];
  /** 所属模板；不传用默认模板。 */
  profileId?: string | null;
}

export interface UpdateShippingZoneInput {
  name?: string;
  countryCodes?: string[];
}

export interface CreateShippingOptionInput {
  zoneId: string;
  name: string;
  carrier?: string | null;
  type: ShippingOptionType;
  amountMinor: bigint;
  currencyCode: string;
  /** free_over 必填且 > 0：满多少免运费。 */
  freeOverThresholdMinor?: bigint | null;
  /** 生效渠道（后台不暴露这个概念，由 API 层填当前启用渠道）。 */
  channelIds: string[];
}

export interface UpdateShippingOptionInput {
  name?: string;
  carrier?: string | null;
  type?: ShippingOptionType;
  amountMinor?: bigint;
  freeOverThresholdMinor?: bigint | null;
  isActive?: boolean;
}

export interface ShippingOptionDTO {
  id: string;
  name: string;
  zone_id: string;
  carrier: string | null;
  type: ShippingOptionType;
  amount_minor: bigint;
  currency_code: string;
  is_active: boolean;
}

export interface PriceRuleDTO {
  id: string;
  rule_type: "weight_based" | "free_over";
  weight_min_g: number | null;
  weight_max_g: number | null;
  order_over_minor: bigint | null;
  amount_minor: bigint;
}

export interface FulfillmentDTO {
  id: string;
  order_id: string;
  /** 所属仓（ADR-013 §3）：一张发货单只发一个仓；历史数据为 null。 */
  stock_location_id: string | null;
  status: FulfillmentStatus;
  reservation_ids: string[];
  /** 本单发了哪些订单行、各几件（状态推进与后台展示用）。 */
  items: FulfillmentItemInput[];
  tracking_links: Array<{ carrier: string; number: string }> | null;
}

export interface ShipmentDTO {
  id: string;
  fulfillment_id: string;
  carrier_name: string;
  tracking_number: string;
  shipped_at: string;
}

export interface FulfillmentItemInput {
  orderLineItemId: string;
  quantity: number;
}

export interface ListShippingOptionsInput {
  channelId: string;
  countryCode: string;
  cartSubtotalMinor: bigint;
  weightGram?: number;
  /** 商品的运费模板；null = 默认模板。 */
  profileId?: string | null;
}

export interface ShippingPriceContext {
  cartSubtotalMinor: bigint;
  weightGram?: number;
}

/** 库存预留明细（跨模块端口视图，按仓拆单要 location + quantity）。 */
export interface ReservationDTO {
  id: string;
  inventory_item_id: string;
  /** 反查出的变体（用于把预留映射到订单行）。 */
  variant_id: string | null;
  stock_location_id: string;
  line_item_id: string;
  order_id: string | null;
  quantity: number;
  status: string;
  workflow_run_id: string | null;
}

/** 发货时把库存预留转真实出库（通过端口调 inventory.commitReservation）。 */
export interface InventoryPort {
  commitReservation(reservationId: string): Promise<void>;
  /** 按订单查未释放的预留明细（发货单按仓关联预留）。 */
  listReservationsByOrder(orderId: string): Promise<ReservationDTO[]>;
}

export interface FulfillmentRepository {
  /** profileId 决定用哪个模板的价格；null 视同默认模板。 */
  listOptionsByChannel(
    channelId: string,
    countryCode: string,
    profileId: string | null,
  ): Promise<ShippingOptionDTO[]>;
  findOption(id: string): Promise<ShippingOptionDTO | null>;
  listRules(optionId: string): Promise<PriceRuleDTO[]>;
  /** 可下单国家（口径与 listOptionsByChannel 完全一致，见 service 注释）。 */
  listDeliverableCountries(profileId?: string | null): Promise<string[]>;

  // ---- 运费模板 ----
  listProfiles(): Promise<ShippingProfileDTO[]>;
  findProfile(id: string): Promise<ShippingProfileDTO | null>;
  findDefaultProfile(): Promise<ShippingProfileDTO | null>;
  insertProfile(input: { id: string; name: string; isDefault: boolean }): Promise<ShippingProfileDTO>;
  updateProfile(id: string, input: { name?: string }): Promise<ShippingProfileDTO>;
  softDeleteProfile(id: string): Promise<void>;
  countZonesInProfile(profileId: string): Promise<number>;

  // ---- 运费配置读写 ----
  listZones(profileId?: string | null): Promise<ShippingZoneDTO[]>;
  findZone(id: string): Promise<ShippingZoneDTO | null>;
  insertZone(input: {
    id: string;
    name: string;
    profileId: string;
    countryCodes: string[];
  }): Promise<ShippingZoneDTO>;
  updateZone(
    id: string,
    input: { name?: string; countryCodes?: string[] },
  ): Promise<ShippingZoneDTO>;
  softDeleteZone(id: string): Promise<void>;
  /** 该区下未删除的运费方式数量（删区守卫：非 0 不许删）。 */
  countOptionsInZone(zoneId: string): Promise<number>;
  listOptionDetailsByZone(zoneId: string): Promise<ShippingOptionDetailDTO[]>;
  findOptionDetail(id: string): Promise<ShippingOptionDetailDTO | null>;
  insertOption(input: {
    id: string;
    zoneId: string;
    name: string;
    carrier: string | null;
    type: ShippingOptionType;
    amountMinor: bigint;
    currencyCode: string;
    /** 同时写入 shipping_option_channel，漏了结账就查不到方案。 */
    channelIds: string[];
  }): Promise<ShippingOptionDetailDTO>;
  updateOption(
    id: string,
    input: {
      name?: string;
      carrier?: string | null;
      type?: ShippingOptionType;
      amountMinor?: bigint;
      isActive?: boolean;
    },
  ): Promise<ShippingOptionDetailDTO>;
  softDeleteOption(id: string): Promise<void>;
  /** 写 free_over 规则：同一 option 只保留一条，先软删旧的重建。 */
  replaceFreeOverRule(optionId: string, ruleId: string, thresholdMinor: bigint): Promise<void>;
  /** 清掉 free_over 规则（切换成别的类型时用）。 */
  clearFreeOverRule(optionId: string): Promise<void>;

  insertFulfillment(input: {
    id: string;
    orderId: string;
    stockLocationId?: string | null;
    status: FulfillmentStatus;
    reservationIds: string[];
  }): Promise<FulfillmentDTO>;
  findFulfillment(id: string): Promise<FulfillmentDTO | null>;
  /** 按订单列出发货单（后台展示「已发哪些仓」，ADR-013 §3）。 */
  listByOrder(orderId: string): Promise<FulfillmentDTO[]>;
  /**
   * 批量取「每个订单的第一条运单」（ADR-057 订单导出用）。
   *
   * 导出上千单时逐单查就是上千次查询；这里一条 join 全取回来。
   * 拆包分批发时只给第一条：导出是给对账看的，一个订单一个主要单号即可。
   */
  listFirstTrackingByOrderIds(
    orderIds: string[],
  ): Promise<Array<{ orderId: string; carrier: string; number: string }>>;
  insertFulfillmentItems(fulfillmentId: string, items: FulfillmentItemInput[]): Promise<void>;
  updateFulfillmentShipped(
    id: string,
    trackingLinks: Array<{ carrier: string; number: string }>,
  ): Promise<void>;
  insertShipment(input: {
    id: string;
    fulfillmentId: string;
    carrierName: string;
    trackingNumber: string;
    shippedAt: Date;
  }): Promise<ShipmentDTO>;
}

export interface IFulfillmentModuleService {
  listShippingOptions(input: ListShippingOptionsInput): Promise<ShippingOptionDTO[]>;
  /** 查单个运费方案（跨模块端口用）。 */
  findShippingOption(id: string): Promise<ShippingOptionDTO | null>;
  /**
   * 能真正下单的国家 = 至少有一个「启用且已绑渠道」的运费方式覆盖。
   *
   * 结账可选国家必须以它为准（成熟做法），不能拿税务清单当配送范围：
   * 否则顾客能选一个没配运费的国家，走到结账才被 400 挡住。
   * 传 profileId 只算该模板；不传则并集所有模板。
   */
  listDeliverableCountries(profileId?: string | null): Promise<string[]>;

  // ---- 运费模板（商品上架时选的就是它）----
  listShippingProfiles(): Promise<ShippingProfileDTO[]>;
  /** 默认模板 id（商品未指定模板时用它）。 */
  getDefaultProfileId(): Promise<string | null>;
  createShippingProfile(input: { name: string }): Promise<ShippingProfileDTO>;
  updateShippingProfile(id: string, input: { name?: string }): Promise<ShippingProfileDTO>;
  /** 模板下还有发货区时拒绝删除；默认模板永远不可删。 */
  deleteShippingProfile(id: string): Promise<void>;

  // ---- 运费配置（后台「设置 → 运费」用，ADR-019 的落地入口）----
  /** 全部发货区（含国家列表），后台一次拿完。 */
  /** 不传 profileId 时返回全部模板的区（后台总览用）。 */
  listShippingZones(profileId?: string | null): Promise<ShippingZoneDTO[]>;
  createShippingZone(input: CreateShippingZoneInput): Promise<ShippingZoneDTO>;
  updateShippingZone(id: string, input: UpdateShippingZoneInput): Promise<ShippingZoneDTO>;
  /** 区内还有运费方式时拒绝删除（避免留下结账算不出运费的国家）。 */
  deleteShippingZone(id: string): Promise<void>;
  /** 某区下的全部运费方式（含停用，后台要能改回来）。 */
  listShippingOptionsByZone(zoneId: string): Promise<ShippingOptionDetailDTO[]>;
  createShippingOption(input: CreateShippingOptionInput): Promise<ShippingOptionDetailDTO>;
  updateShippingOption(
    id: string,
    input: UpdateShippingOptionInput,
  ): Promise<ShippingOptionDetailDTO>;
  deleteShippingOption(id: string): Promise<void>;

  /** 按订单列出发货单（后台展示「已发哪些仓」）。 */
  listByOrder(orderId: string): Promise<FulfillmentDTO[]>;
  /** 批量取每个订单的第一条运单（导出用，一次查询）。 */
  listFirstTrackingByOrderIds(
    orderIds: string[],
  ): Promise<Array<{ orderId: string; carrier: string; number: string }>>;
  /** 查单个发货单（发货前反查所属订单，判断是否在退款审核中）。 */
  findFulfillment(id: string): Promise<FulfillmentDTO | null>;
  calculateShippingPrice(
    optionId: string,
    ctx: ShippingPriceContext,
  ): Promise<{ amountMinor: bigint; currencyCode: string }>;
  createFulfillment(input: {
    orderId: string;
    /** 指定发货仓；不传时仅当订单预留只落一个仓才允许（兼容单仓流程）。 */
    stockLocationId?: string;
    items: FulfillmentItemInput[];
    reservationIds?: string[];
  }): Promise<FulfillmentDTO>;
  addShipment(
    fulfillmentId: string,
    input: { carrierName: string; trackingNumber: string; shippedAt: Date },
  ): Promise<ShipmentDTO>;
}
