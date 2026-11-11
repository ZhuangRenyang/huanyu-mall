import { prefixedUlid } from "@mall/core";
import {
  fulfillmentNotFound,
  fulfillmentQuantityMismatch,
  noReservationAtLocation,
  noReservations,
  optionNotFound,
  reservationNotInLocation,
  stockLocationRequired,
} from "../errors.js";
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

  /**
   * 建发货单（ADR-013 §3：一张发货单只发一个仓）。
   * 1) 取订单 reserved 预留；2) 按仓去重；3) 指定仓 / 单仓自动 / 跨仓拒绝；
   * 4) reservationIds 必须是所选仓子集；5) 数量必须等于该仓预留合计（一期不支持部分发货）。
   */
  async createFulfillment(input: {
    orderId: string;
    stockLocationId?: string;
    items: FulfillmentItemInput[];
    reservationIds?: string[];
  }): Promise<FulfillmentDTO> {
    const reservations = await this.deps.inventory.listReservationsByOrder(input.orderId);
    if (reservations.length === 0) throw noReservations(input.orderId);

    const locations = [...new Set(reservations.map((r) => r.stock_location_id))];
    let scoped = reservations;
    if (input.stockLocationId) {
      scoped = reservations.filter((r) => r.stock_location_id === input.stockLocationId);
      if (scoped.length === 0) {
        throw noReservationAtLocation(input.orderId, input.stockLocationId);
      }
    } else if (locations.length > 1) {
      throw stockLocationRequired(input.orderId, locations);
    }

    let reservationIds = scoped.map((r) => r.id);
    if (input.reservationIds && input.reservationIds.length > 0) {
      const allowed = new Set(reservationIds);
      for (const id of input.reservationIds) {
        if (!allowed.has(id)) throw reservationNotInLocation(input.orderId, id);
      }
      reservationIds = input.reservationIds;
    }

    const expected = scoped.reduce((sum, r) => sum + r.quantity, 0);
    const actual = input.items.reduce((sum, i) => sum + i.quantity, 0);
    if (expected !== actual) throw fulfillmentQuantityMismatch(expected, actual);

    const stockLocationId = input.stockLocationId ?? scoped[0]!.stock_location_id;
    const id = prefixedUlid("fulf");
    const fulfillment = await this.deps.repo.insertFulfillment({
      id,
      orderId: input.orderId,
      stockLocationId,
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
