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
  status: FulfillmentStatus;
  reservation_ids: string[];
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

/** 发货时把库存预留转真实出库（通过端口调 inventory.commitReservation）。 */
export interface InventoryPort {
  commitReservation(reservationId: string): Promise<void>;
  /** 按订单查未释放的预留 id（发货单自动关联预留）。 */
  listReservationsByOrder(orderId: string): Promise<string[]>;
}

export interface FulfillmentRepository {
  listOptionsByChannel(channelId: string, countryCode: string): Promise<ShippingOptionDTO[]>;
  findOption(id: string): Promise<ShippingOptionDTO | null>;
  listRules(optionId: string): Promise<PriceRuleDTO[]>;
  insertFulfillment(input: {
    id: string;
    orderId: string;
    status: FulfillmentStatus;
    reservationIds: string[];
  }): Promise<FulfillmentDTO>;
  findFulfillment(id: string): Promise<FulfillmentDTO | null>;
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
  calculateShippingPrice(
    optionId: string,
    ctx: ShippingPriceContext,
  ): Promise<{ amountMinor: bigint; currencyCode: string }>;
  createFulfillment(input: {
    orderId: string;
    items: FulfillmentItemInput[];
    reservationIds?: string[];
  }): Promise<FulfillmentDTO>;
  addShipment(
    fulfillmentId: string,
    input: { carrierName: string; trackingNumber: string; shippedAt: Date },
  ): Promise<ShipmentDTO>;
}
