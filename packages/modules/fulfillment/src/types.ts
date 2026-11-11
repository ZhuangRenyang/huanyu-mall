/** M08 Fulfillment DTO 与契约（对齐架构 §2.1）。承运商 API 不接，发货手填。 */

export type ShippingOptionType = "flat" | "weight_based" | "free_over";
export type FulfillmentStatus = "not_fulfilled" | "fulfilled" | "shipped" | "delivered" | "canceled";

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
  listOptionsByChannel(channelId: string, countryCode: string): Promise<ShippingOptionDTO[]>;
  findOption(id: string): Promise<ShippingOptionDTO | null>;
  listRules(optionId: string): Promise<PriceRuleDTO[]>;
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
  /** 按订单列出发货单（后台展示「已发哪些仓」）。 */
  listByOrder(orderId: string): Promise<FulfillmentDTO[]>;
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
