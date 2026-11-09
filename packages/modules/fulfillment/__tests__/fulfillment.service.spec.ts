import { describe, expect, it } from "vitest";
import { FulfillmentService } from "../src/services/fulfillment.service.js";
import type {
  FulfillmentDTO,
  FulfillmentItemInput,
  FulfillmentRepository,
  FulfillmentStatus,
  InventoryPort,
  PriceRuleDTO,
  ShipmentDTO,
  ShippingOptionDTO,
} from "../src/types.js";

class InMemoryFulfillmentRepository implements FulfillmentRepository {
  readonly options = new Map<string, ShippingOptionDTO>();
  readonly rules = new Map<string, PriceRuleDTO[]>();
  readonly channelOptions = new Map<string, string[]>();
  readonly fulfillments = new Map<string, FulfillmentDTO>();
  readonly shipments = new Map<string, ShipmentDTO>();
  readonly items: FulfillmentItemInput[] = [];

  async listOptionsByChannel(channelId: string): Promise<ShippingOptionDTO[]> {
    return (this.channelOptions.get(channelId) ?? [])
      .map((id) => this.options.get(id))
      .filter((o): o is ShippingOptionDTO => o !== undefined);
  }
  async findOption(id: string): Promise<ShippingOptionDTO | null> {
    return this.options.get(id) ?? null;
  }
  async listRules(optionId: string): Promise<PriceRuleDTO[]> {
    return this.rules.get(optionId) ?? [];
  }
  async insertFulfillment(input: {
    id: string;
    orderId: string;
    status: FulfillmentStatus;
    reservationIds: string[];
  }): Promise<FulfillmentDTO> {
    const dto: FulfillmentDTO = {
      id: input.id,
      order_id: input.orderId,
      status: input.status,
      reservation_ids: input.reservationIds,
      tracking_links: null,
    };
    this.fulfillments.set(dto.id, dto);
    return dto;
  }
  async findFulfillment(id: string): Promise<FulfillmentDTO | null> {
    return this.fulfillments.get(id) ?? null;
  }
  async insertFulfillmentItems(_fulfillmentId: string, items: FulfillmentItemInput[]): Promise<void> {
    this.items.push(...items);
  }
  async updateFulfillmentShipped(
    id: string,
    trackingLinks: Array<{ carrier: string; number: string }>,
  ): Promise<void> {
    const f = this.fulfillments.get(id);
    if (f) {
      f.status = "shipped";
      f.tracking_links = trackingLinks;
    }
  }
  async insertShipment(input: {
    id: string;
    fulfillmentId: string;
    carrierName: string;
    trackingNumber: string;
    shippedAt: Date;
  }): Promise<ShipmentDTO> {
    const dto: ShipmentDTO = {
      id: input.id,
      fulfillment_id: input.fulfillmentId,
      carrier_name: input.carrierName,
      tracking_number: input.trackingNumber,
      shipped_at: input.shippedAt.toISOString(),
    };
    this.shipments.set(dto.id, dto);
    return dto;
  }
}

class FakeInventoryPort implements InventoryPort {
  readonly committed: string[] = [];
  async commitReservation(reservationId: string): Promise<void> {
    this.committed.push(reservationId);
  }
}

function option(over: Partial<ShippingOptionDTO> & { id: string; type: ShippingOptionDTO["type"] }): ShippingOptionDTO {
  return {
    id: over.id,
    name: over.name ?? over.id,
    zone_id: over.zone_id ?? "zone_1",
    carrier: over.carrier ?? null,
    type: over.type,
    amount_minor: over.amount_minor ?? 0n,
    currency_code: over.currency_code ?? "CNY",
    is_active: over.is_active ?? true,
  };
}

function setup() {
  const repo = new InMemoryFulfillmentRepository();
  const inventory = new FakeInventoryPort();
  const service = new FulfillmentService({ repo, inventory });

  repo.options.set("opt_flat", option({ id: "opt_flat", type: "flat", amount_minor: 800n }));
  repo.options.set("opt_free", option({ id: "opt_free", type: "free_over", amount_minor: 800n }));
  repo.options.set("opt_weight", option({ id: "opt_weight", type: "weight_based", amount_minor: 0n }));
  repo.rules.set("opt_free", [
    { id: "r1", rule_type: "free_over", weight_min_g: null, weight_max_g: null, order_over_minor: 5000n, amount_minor: 0n },
  ]);
  repo.rules.set("opt_weight", [
    { id: "r2", rule_type: "weight_based", weight_min_g: 0, weight_max_g: 500, order_over_minor: null, amount_minor: 500n },
    { id: "r3", rule_type: "weight_based", weight_min_g: 501, weight_max_g: 2000, order_over_minor: null, amount_minor: 800n },
  ]);
  repo.channelOptions.set("chn_cn", ["opt_flat", "opt_free", "opt_weight"]);

  return { repo, inventory, service };
}

describe("FulfillmentService（M08，运费三档 + 发货 commit 预留）", () => {
  it("固定运费（flat）", async () => {
    const { service } = setup();
    const price = await service.calculateShippingPrice("opt_flat", { cartSubtotalMinor: 1000n });
    expect(price.amountMinor).toBe(800n);
  });

  it("满额包邮（free_over）：达标 0，未达标收基础运费", async () => {
    const { service } = setup();
    const free = await service.calculateShippingPrice("opt_free", { cartSubtotalMinor: 10000n });
    expect(free.amountMinor).toBe(0n);
    const paid = await service.calculateShippingPrice("opt_free", { cartSubtotalMinor: 3000n });
    expect(paid.amountMinor).toBe(800n);
  });

  it("重量阶梯（weight_based）：命中区间取对应价", async () => {
    const { service } = setup();
    const light = await service.calculateShippingPrice("opt_weight", { cartSubtotalMinor: 0n, weightGram: 300 });
    expect(light.amountMinor).toBe(500n);
    const heavy = await service.calculateShippingPrice("opt_weight", { cartSubtotalMinor: 0n, weightGram: 1000 });
    expect(heavy.amountMinor).toBe(800n);
  });

  it("listShippingOptions 按渠道返回启用项", async () => {
    const { service } = setup();
    const list = await service.listShippingOptions({ channelId: "chn_cn", countryCode: "CN", cartSubtotalMinor: 0n });
    expect(list.map((o) => o.id).sort()).toEqual(["opt_flat", "opt_free", "opt_weight"]);
  });

  it("发货后 inventory 预留被 commit（端口断言）", async () => {
    const { repo, inventory, service } = setup();
    const fulfillment = await service.createFulfillment({
      orderId: "ord_1",
      items: [{ orderLineItemId: "oli_1", quantity: 1 }],
      reservationIds: ["rsv_1", "rsv_2"],
    });
    expect(fulfillment.reservation_ids).toEqual(["rsv_1", "rsv_2"]);

    const shipment = await service.addShipment(fulfillment.id, {
      carrierName: "顺丰",
      trackingNumber: "SF123456",
      shippedAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(shipment.tracking_number).toBe("SF123456");
    expect(inventory.committed).toEqual(["rsv_1", "rsv_2"]);
    expect(repo.fulfillments.get(fulfillment.id)?.status).toBe("shipped");
  });
});
