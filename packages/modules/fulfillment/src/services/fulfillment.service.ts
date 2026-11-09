import { prefixedUlid } from "@mall/core";
import { fulfillmentNotFound, optionNotFound } from "../errors.js";
import { calculateShipping } from "./shipping-calculator.js";
import type {
  FulfillmentDTO,
  FulfillmentItemInput,
  FulfillmentRepository,
  IFulfillmentModuleService,
  InventoryPort,
  ListShippingOptionsInput,
  ShipmentDTO,
  ShippingOptionDTO,
  ShippingPriceContext,
} from "../types.js";

export interface FulfillmentServiceDeps {
  repo: FulfillmentRepository;
  inventory: InventoryPort;
}

/** M08 对外门面。承运商 API 不接（手填）；发货时经端口把库存预留 commit 为出库。 */
export class FulfillmentService implements IFulfillmentModuleService {
  constructor(private readonly deps: FulfillmentServiceDeps) {}

  async listShippingOptions(input: ListShippingOptionsInput): Promise<ShippingOptionDTO[]> {
    const options = await this.deps.repo.listOptionsByChannel(input.channelId, input.countryCode);
    return options.filter((o) => o.is_active);
  }

  /** 查运费方案（跨模块端口：cart 选运费时后端回填方案名与金额）。 */
  async findShippingOption(id: string): Promise<ShippingOptionDTO | null> {
    return this.deps.repo.findOption(id);
  }

  async calculateShippingPrice(
    optionId: string,
    ctx: ShippingPriceContext,
  ): Promise<{ amountMinor: bigint; currencyCode: string }> {
    const option = await this.deps.repo.findOption(optionId);
    if (!option) throw optionNotFound(optionId);
    const rules = await this.deps.repo.listRules(optionId);
    return { amountMinor: calculateShipping(option, rules, ctx), currencyCode: option.currency_code };
  }

  async createFulfillment(input: {
    orderId: string;
    items: FulfillmentItemInput[];
    reservationIds?: string[];
  }): Promise<FulfillmentDTO> {
    const id = prefixedUlid("fulf");
    // 未显式传预留时（未指定或空数组），按订单自动关联（发货要把预留转真实出库）
    const reservationIds =
      input.reservationIds && input.reservationIds.length > 0
        ? input.reservationIds
        : await this.deps.inventory.listReservationsByOrder(input.orderId);
    const fulfillment = await this.deps.repo.insertFulfillment({
      id,
      orderId: input.orderId,
      status: "fulfilled",
      reservationIds,
    });
    await this.deps.repo.insertFulfillmentItems(id, input.items);
    return fulfillment;
  }

  async addShipment(
    fulfillmentId: string,
    input: { carrierName: string; trackingNumber: string; shippedAt: Date },
  ): Promise<ShipmentDTO> {
    const fulfillment = await this.deps.repo.findFulfillment(fulfillmentId);
    if (!fulfillment) throw fulfillmentNotFound(fulfillmentId);

    const shipment = await this.deps.repo.insertShipment({
      id: prefixedUlid("ship"),
      fulfillmentId,
      carrierName: input.carrierName,
      trackingNumber: input.trackingNumber,
      shippedAt: input.shippedAt,
    });

    // 发货：预留转真实出库（端口调 inventory.commitReservation）
    for (const reservationId of fulfillment.reservation_ids) {
      await this.deps.inventory.commitReservation(reservationId);
    }

    await this.deps.repo.updateFulfillmentShipped(fulfillmentId, [
      { carrier: input.carrierName, number: input.trackingNumber },
    ]);
    return shipment;
  }
}
