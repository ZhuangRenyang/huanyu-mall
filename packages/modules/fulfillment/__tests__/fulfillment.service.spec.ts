import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { FulfillmentService } from "../src/services/fulfillment.service.js";
import type {
  FulfillmentDTO,
  FulfillmentItemInput,
  FulfillmentRepository,
  FulfillmentStatus,
  InventoryPort,
  PriceRuleDTO,
  ReservationDTO,
  ShipmentDTO,
  ShippingOptionDTO,
  ShippingOptionDetailDTO,
  ShippingProfileDTO,
  ShippingZoneDTO,
} from "../src/types.js";

class InMemoryFulfillmentRepository implements FulfillmentRepository {
  readonly options = new Map<string, ShippingOptionDTO>();
  readonly rules = new Map<string, PriceRuleDTO[]>();
  readonly channelOptions = new Map<string, string[]>();
  readonly fulfillments = new Map<string, FulfillmentDTO>();
  readonly shipments = new Map<string, ShipmentDTO>();
  readonly items: FulfillmentItemInput[] = [];

  async listOptionsByChannel(
    channelId: string,
    _countryCode?: string,
    _profileId?: string | null,
  ): Promise<ShippingOptionDTO[]> {
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
    stockLocationId?: string | null;
    status: FulfillmentStatus;
    reservationIds: string[];
  }): Promise<FulfillmentDTO> {
    const dto: FulfillmentDTO = {
      id: input.id,
      order_id: input.orderId,
      stock_location_id: input.stockLocationId ?? null,
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

  // ---- 运费配置（内存版，够跑守卫逻辑）----
  readonly zones = new Map<string, ShippingZoneDTO>();
  readonly optionDetails = new Map<string, ShippingOptionDetailDTO>();

  async listDeliverableCountries(profileId?: string | null): Promise<string[]> {
    const set = new Set<string>();
    for (const option of this.optionDetails.values()) {
      if (!option.is_active) continue;
      const zone = this.zones.get(option.zone_id);
      if (!zone) continue;
      if (profileId !== undefined && zone.profile_id !== profileId) continue;
      for (const code of zone.country_codes) set.add(code);
    }
    return [...set].sort();
  }

  readonly profiles = new Map<string, ShippingProfileDTO>();

  async listProfiles(): Promise<ShippingProfileDTO[]> {
    return [...this.profiles.values()];
  }
  async findProfile(id: string): Promise<ShippingProfileDTO | null> {
    return this.profiles.get(id) ?? null;
  }
  async findDefaultProfile(): Promise<ShippingProfileDTO | null> {
    return [...this.profiles.values()].find((p) => p.is_default) ?? null;
  }
  async insertProfile(input: {
    id: string;
    name: string;
    isDefault: boolean;
  }): Promise<ShippingProfileDTO> {
    const dto = { id: input.id, name: input.name, is_default: input.isDefault };
    this.profiles.set(dto.id, dto);
    return dto;
  }
  async updateProfile(id: string, input: { name?: string }): Promise<ShippingProfileDTO> {
    const p = this.profiles.get(id)!;
    if (input.name !== undefined) p.name = input.name;
    return p;
  }
  async softDeleteProfile(id: string): Promise<void> {
    this.profiles.delete(id);
  }
  async countZonesInProfile(profileId: string): Promise<number> {
    return [...this.zones.values()].filter((z) => z.profile_id === profileId).length;
  }

  async listZones(profileId?: string | null): Promise<ShippingZoneDTO[]> {
    const all = [...this.zones.values()];
    if (profileId === undefined) return all;
    return all.filter((z) => z.profile_id === profileId);
  }

  async findZone(id: string): Promise<ShippingZoneDTO | null> {
    return this.zones.get(id) ?? null;
  }

  async insertZone(input: {
    id: string;
    name: string;
    profileId: string;
    countryCodes: string[];
  }): Promise<ShippingZoneDTO> {
    const dto: ShippingZoneDTO = {
      id: input.id,
      name: input.name,
      profile_id: input.profileId,
      country_codes: input.countryCodes,
    };
    this.zones.set(dto.id, dto);
    return dto;
  }

  async updateZone(
    id: string,
    input: { name?: string; countryCodes?: string[] },
  ): Promise<ShippingZoneDTO> {
    const zone = this.zones.get(id)!;
    if (input.name !== undefined) zone.name = input.name;
    if (input.countryCodes !== undefined) zone.country_codes = input.countryCodes;
    return zone;
  }

  async softDeleteZone(id: string): Promise<void> {
    this.zones.delete(id);
  }

  async countOptionsInZone(zoneId: string): Promise<number> {
    return [...this.optionDetails.values()].filter((o) => o.zone_id === zoneId).length;
  }

  async listOptionDetailsByZone(zoneId: string): Promise<ShippingOptionDetailDTO[]> {
    return [...this.optionDetails.values()].filter((o) => o.zone_id === zoneId);
  }

  async findOptionDetail(id: string): Promise<ShippingOptionDetailDTO | null> {
    return this.optionDetails.get(id) ?? null;
  }

  async insertOption(input: {
    id: string;
    zoneId: string;
    name: string;
    carrier: string | null;
    type: ShippingOptionDTO["type"];
    amountMinor: bigint;
    currencyCode: string;
    channelIds: string[];
  }): Promise<ShippingOptionDetailDTO> {
    const dto: ShippingOptionDetailDTO = {
      id: input.id,
      name: input.name,
      zone_id: input.zoneId,
      carrier: input.carrier,
      type: input.type,
      amount_minor: input.amountMinor,
      currency_code: input.currencyCode,
      is_active: true,
      free_over_threshold_minor: null,
    };
    this.optionDetails.set(dto.id, dto);
    // 结账侧走 findOption，两处必须同步：漏一处就是「后台配好了、结账查不到」
    this.options.set(dto.id, {
      id: dto.id,
      name: dto.name,
      zone_id: dto.zone_id,
      carrier: dto.carrier,
      type: dto.type,
      amount_minor: dto.amount_minor,
      currency_code: dto.currency_code,
      is_active: dto.is_active,
    });
    for (const channelId of input.channelIds) {
      const list = this.channelOptions.get(channelId) ?? [];
      this.channelOptions.set(channelId, [...list, dto.id]);
    }
    return dto;
  }

  async updateOption(
    id: string,
    input: {
      name?: string;
      carrier?: string | null;
      type?: ShippingOptionDTO["type"];
      amountMinor?: bigint;
      isActive?: boolean;
    },
  ): Promise<ShippingOptionDetailDTO> {
    const option = this.optionDetails.get(id)!;
    if (input.name !== undefined) option.name = input.name;
    if (input.carrier !== undefined) option.carrier = input.carrier;
    if (input.type !== undefined) option.type = input.type;
    if (input.amountMinor !== undefined) option.amount_minor = input.amountMinor;
    if (input.isActive !== undefined) option.is_active = input.isActive;
    const plain = this.options.get(id);
    if (plain) {
      plain.name = option.name;
      plain.carrier = option.carrier;
      plain.type = option.type;
      plain.amount_minor = option.amount_minor;
      plain.is_active = option.is_active;
    }
    return option;
  }

  async softDeleteOption(id: string): Promise<void> {
    this.optionDetails.delete(id);
  }

  async replaceFreeOverRule(
    optionId: string,
    ruleId: string,
    thresholdMinor: bigint,
  ): Promise<void> {
    this.rules.set(optionId, [
      { id: ruleId, rule_type: "free_over", weight_min_g: null, weight_max_g: null, order_over_minor: thresholdMinor, amount_minor: 0n },
    ]);
    const option = this.optionDetails.get(optionId);
    if (option) option.free_over_threshold_minor = thresholdMinor;
  }

  async clearFreeOverRule(optionId: string): Promise<void> {
    this.rules.set(
      optionId,
      (this.rules.get(optionId) ?? []).filter((r) => r.rule_type !== "free_over"),
    );
    const option = this.optionDetails.get(optionId);
    if (option) option.free_over_threshold_minor = null;
  }
}

class FakeInventoryPort implements InventoryPort {
  readonly committed: string[] = [];
  readonly reservations = new Map<string, ReservationDTO[]>();

  async commitReservation(reservationId: string): Promise<void> {
    this.committed.push(reservationId);
  }
  async listReservationsByOrder(orderId: string): Promise<ReservationDTO[]> {
    return this.reservations.get(orderId) ?? [];
  }
}

/** 造一条预留（默认 loc_1、reserved、数量 1）。 */
function reservation(
  id: string,
  stockLocationId: string,
  quantity = 1,
  orderId = "ord_1",
): ReservationDTO {
  return {
    id,
    inventory_item_id: "invitem_1",
    stock_location_id: stockLocationId,
    line_item_id: `${orderId}:var_1:${stockLocationId}`,
    order_id: orderId,
    quantity,
    status: "reserved",
    workflow_run_id: null,
  };
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
  // 每个用例都有默认模板：service 的 resolveProfileId 依赖它
  repo.profiles.set("shprof_default", { id: "shprof_default", name: "默认运费模板", is_default: true });

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
    inventory.reservations.set("ord_1", [reservation("rsv_1", "loc_1"), reservation("rsv_2", "loc_1")]);

    const fulfillment = await service.createFulfillment({
      orderId: "ord_1",
      items: [{ orderLineItemId: "oli_1", quantity: 2 }],
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

  it("发货后发出 shipment.created，并带上订单行项（订单状态推进用）", async () => {
    const repo = new InMemoryFulfillmentRepository();
    const inventory = new FakeInventoryPort();
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    const service = new FulfillmentService({
      repo,
      inventory,
      events: async (event) => {
        events.push(event);
      },
    });
    inventory.reservations.set("ord_1", [reservation("rsv_1", "loc_1")]);

    const fulfillment = await service.createFulfillment({
      orderId: "ord_1",
      items: [{ orderLineItemId: "oli_1", quantity: 1 }],
      reservationIds: ["rsv_1"],
    });
    expect(fulfillment.items).toEqual([{ orderLineItemId: "oli_1", quantity: 1 }]);

    await service.addShipment(fulfillment.id, {
      carrierName: "顺丰",
      trackingNumber: "SF1",
      shippedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(events).toEqual([
      { name: "shipment.created", data: { orderId: "ord_1", fulfillmentId: fulfillment.id } },
    ]);
  });
});

describe("FulfillmentService.createFulfillment（ADR-013 §3：一张发货单只发一个仓）", () => {
  it("单仓不传 location：自动用该仓，落库写入 stock_location_id", async () => {
    const { repo, inventory, service } = setup();
    inventory.reservations.set("ord_1", [reservation("rsv_1", "loc_1", 3)]);

    const fulfillment = await service.createFulfillment({
      orderId: "ord_1",
      items: [{ orderLineItemId: "oli_1", quantity: 3 }],
    });

    expect(fulfillment.stock_location_id).toBe("loc_1");
    expect(fulfillment.reservation_ids).toEqual(["rsv_1"]);
    expect(repo.items).toEqual([{ orderLineItemId: "oli_1", quantity: 3 }]);
  });

  it("跨两仓不传 location → stockLocationRequired，details 带可选仓列表", async () => {
    const { inventory, service } = setup();
    inventory.reservations.set("ord_1", [
      reservation("rsv_a", "loc_a", 2),
      reservation("rsv_b", "loc_b", 1),
    ]);

    const err = await service
      .createFulfillment({
        orderId: "ord_1",
        items: [{ orderLineItemId: "oli_1", quantity: 3 }],
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).message).toContain("stock_location_id");
    expect((err as DomainError).details).toEqual(["loc_a", "loc_b"]);
  });

  it("指定 location → 只关联该仓预留，且 stock_location_id 为该仓", async () => {
    const { inventory, service } = setup();
    inventory.reservations.set("ord_1", [
      reservation("rsv_a", "loc_a", 2),
      reservation("rsv_b", "loc_b", 1),
    ]);

    const fulfillment = await service.createFulfillment({
      orderId: "ord_1",
      stockLocationId: "loc_b",
      items: [{ orderLineItemId: "oli_1", quantity: 1 }],
    });

    expect(fulfillment.stock_location_id).toBe("loc_b");
    expect(fulfillment.reservation_ids).toEqual(["rsv_b"]);
  });

  it("数量与该仓预留不一致 → fulfillmentQuantityMismatch", async () => {
    const { inventory, service } = setup();
    inventory.reservations.set("ord_1", [reservation("rsv_1", "loc_1", 3)]);

    const err = await service
      .createFulfillment({
        orderId: "ord_1",
        items: [{ orderLineItemId: "oli_1", quantity: 1 }],
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).message).toContain("预留 3");
  });

  it("reservationIds 不属于所选仓 → reservationNotInLocation", async () => {
    const { inventory, service } = setup();
    inventory.reservations.set("ord_1", [
      reservation("rsv_a", "loc_a", 1),
      reservation("rsv_b", "loc_b", 1),
    ]);

    const err = await service
      .createFulfillment({
        orderId: "ord_1",
        stockLocationId: "loc_a",
        items: [{ orderLineItemId: "oli_1", quantity: 1 }],
        reservationIds: ["rsv_b"],
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).message).toContain("rsv_b");
  });

  it("订单无预留 → noReservations", async () => {
    const { service } = setup();
    const err = await service
      .createFulfillment({ orderId: "ord_x", items: [{ orderLineItemId: "oli_1", quantity: 1 }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).message).toContain("没有可发货的预留");
  });
});

/**
 * 运费配置守卫（ADR-019）。
 *
 * 这里守的不是「能不能存」，而是**能不能绕过**：
 * 同一国家落进两个区 → 两套价格同时命中，系统只能挑一个，等于开了口子。
 */
describe("运费配置（发货区 / 运费方式）", () => {
  it("建区：国家码统一大写并去重", async () => {
    const { service } = setup();
    const zone = await service.createShippingZone({ name: "中国大陆", countryCodes: ["cn", "CN"] });
    expect(zone.country_codes).toEqual(["CN"]);
  });

  it("同一国家不能属于两个区（否则两套价格同时命中）", async () => {
    const { service } = setup();
    await service.createShippingZone({ name: "中国大陆", countryCodes: ["CN"] });
    const err = await service
      .createShippingZone({ name: "华北", countryCodes: ["CN", "JP"] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).message).toContain("CN");
  });

  it("编辑区时排除自己，不会误判冲突", async () => {
    const { service } = setup();
    const zone = await service.createShippingZone({ name: "中国大陆", countryCodes: ["CN"] });
    const updated = await service.updateShippingZone(zone.id, {
      name: "中国大陆及港澳",
      countryCodes: ["CN", "HK"],
    });
    expect(updated.country_codes).toEqual(["CN", "HK"]);
  });

  it("非法国家码直接拒绝（不接受 CN-1 / CHINA 这类）", async () => {
    const { service } = setup();
    const err = await service
      .createShippingZone({ name: "错区", countryCodes: ["CHINA"] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
  });

  it("区内还有运费方式时禁止删区（否则该国结账算不出运费）", async () => {
    const { service } = setup();
    const zone = await service.createShippingZone({ name: "中国大陆", countryCodes: ["CN"] });
    await service.createShippingOption({
      zoneId: zone.id,
      name: "标准快递",
      type: "flat",
      amountMinor: 800n,
      currencyCode: "CNY",
      channelIds: ["chn_cn"],
    });
    const err = await service.deleteShippingZone(zone.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).message).toContain("运费方式");
  });

  it("满额包邮必须有门槛；门槛 0 拒绝（全场包邮该用固定价 0）", async () => {
    const { service } = setup();
    const zone = await service.createShippingZone({ name: "中国大陆", countryCodes: ["CN"] });
    const noThreshold = await service
      .createShippingOption({
        zoneId: zone.id,
        name: "满额包邮",
        type: "free_over",
        amountMinor: 800n,
        currencyCode: "CNY",
        channelIds: ["chn_cn"],
      })
      .catch((e: unknown) => e);
    expect(noThreshold).toBeInstanceOf(DomainError);

    const zero = await service
      .createShippingOption({
        zoneId: zone.id,
        name: "满额包邮",
        type: "free_over",
        amountMinor: 800n,
        currencyCode: "CNY",
        freeOverThresholdMinor: 0n,
        channelIds: ["chn_cn"],
      })
      .catch((e: unknown) => e);
    expect(zero).toBeInstanceOf(DomainError);
  });

  it("建好的满额包邮能被结账直接算出（门槛生效，不是只存了配置）", async () => {
    const { service } = setup();
    const zone = await service.createShippingZone({ name: "中国大陆", countryCodes: ["CN"] });
    const created = await service.createShippingOption({
      zoneId: zone.id,
      name: "满 99 包邮",
      type: "free_over",
      amountMinor: 800n,
      currencyCode: "CNY",
      freeOverThresholdMinor: 9900n,
      channelIds: ["chn_cn"],
    });
    expect(created.free_over_threshold_minor).toBe(9900n);

    const below = await service.calculateShippingPrice(created.id, { cartSubtotalMinor: 5000n });
    expect(below.amountMinor).toBe(800n);
    const above = await service.calculateShippingPrice(created.id, { cartSubtotalMinor: 12000n });
    expect(above.amountMinor).toBe(0n);
  });

  it("从满额包邮改成固定价后，旧门槛必须失效", async () => {
    const { service } = setup();
    const zone = await service.createShippingZone({ name: "中国大陆", countryCodes: ["CN"] });
    const created = await service.createShippingOption({
      zoneId: zone.id,
      name: "满 99 包邮",
      type: "free_over",
      amountMinor: 800n,
      currencyCode: "CNY",
      freeOverThresholdMinor: 9900n,
      channelIds: ["chn_cn"],
    });
    await service.updateShippingOption(created.id, { type: "flat", amountMinor: 1200n });

    // 买家买 2 万也应照收 12 元：门槛规则必须已被清掉
    const price = await service.calculateShippingPrice(created.id, { cartSubtotalMinor: 20000n });
    expect(price.amountMinor).toBe(1200n);
  });

  it("可下单国家只算启用了的运费方式", async () => {
    const { service } = setup();
    const zone = await service.createShippingZone({ name: "中国大陆", countryCodes: ["CN"] });
    expect(await service.listDeliverableCountries()).toEqual([]);

    const option = await service.createShippingOption({
      zoneId: zone.id,
      name: "标准快递",
      type: "flat",
      amountMinor: 800n,
      currencyCode: "CNY",
      channelIds: ["chn_cn"],
    });
    expect(await service.listDeliverableCountries()).toEqual(["CN"]);

    await service.updateShippingOption(option.id, { isActive: false });
    expect(await service.listDeliverableCountries()).toEqual([]);
  });
});

/**
 * 运费模板（ADR-021，对齐淘宝「运费模板」）。
 *
 * 模板是商品上架时选的东西，所以它的守卫要保证：
 * 默认模板一直在（否则一堆商品算不出运费）、有地区的模板不能删。
 */
describe("运费模板", () => {
  it("新建模板非默认；默认模板不可删除", async () => {
    const { service } = setup();
    const created = await service.createShippingProfile({ name: "重货专线" });
    expect(created.is_default).toBe(false);

    const err = await service.deleteShippingProfile("shprof_default").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).message).toContain("默认");
  });

  it("模板下还有发货区时不可删", async () => {
    const { service } = setup();
    const profile = await service.createShippingProfile({ name: "重货专线" });
    await service.createShippingZone({
      name: "中国大陆",
      countryCodes: ["CN"],
      profileId: profile.id,
    });
    const err = await service.deleteShippingProfile(profile.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
  });

  it("同一国家可以出现在不同模板（这正是多模板的意义）", async () => {
    const { service } = setup();
    const heavy = await service.createShippingProfile({ name: "重货专线" });

    await service.createShippingZone({ name: "默认-中国大陆", countryCodes: ["CN"] });
    // 不抛错：跨模板允许同一国家
    const zone = await service.createShippingZone({
      name: "重货-中国大陆",
      countryCodes: ["CN"],
      profileId: heavy.id,
    });
    expect(zone.profile_id).toBe(heavy.id);
  });

  it("可下单国家可以按模板分别统计", async () => {
    const { service } = setup();
    const heavy = await service.createShippingProfile({ name: "重货专线" });
    const defaultZone = await service.createShippingZone({ name: "中国大陆", countryCodes: ["CN"] });
    await service.createShippingOption({
      zoneId: defaultZone.id,
      name: "标准快递",
      type: "flat",
      amountMinor: 800n,
      currencyCode: "CNY",
      channelIds: ["chn_cn"],
    });
    const heavyZone = await service.createShippingZone({
      name: "重货-东南亚",
      countryCodes: ["SG"],
      profileId: heavy.id,
    });
    await service.createShippingOption({
      zoneId: heavyZone.id,
      name: "重货专线",
      type: "flat",
      amountMinor: 3000n,
      currencyCode: "CNY",
      channelIds: ["chn_cn"],
    });

    expect(await service.listDeliverableCountries()).toEqual(["CN", "SG"]);
    expect(await service.listDeliverableCountries("shprof_default")).toEqual(["CN"]);
    expect(await service.listDeliverableCountries(heavy.id)).toEqual(["SG"]);
  });
});
