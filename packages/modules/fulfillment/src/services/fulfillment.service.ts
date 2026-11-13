import { prefixedUlid } from "@mall/core";
import {
  countryAlreadyInZone,
  defaultProfileUndeletable,
  freeOverThresholdRequired,
  fulfillmentNotFound,
  fulfillmentQuantityMismatch,
  invalidShippingAmount,
  invalidShippingCountry,
  noReservationAtLocation,
  noReservations,
  optionNotFound,
  profileHasZones,
  profileNotFound,
  reservationNotInLocation,
  stockLocationRequired,
  zoneHasOptions,
  zoneNotFound,
} from "../errors.js";
import { calculateShipping } from "./shipping-calculator.js";
import type {
  CreateShippingOptionInput,
  CreateShippingZoneInput,
  FulfillmentDTO,
  FulfillmentItemInput,
  FulfillmentRepository,
  IFulfillmentModuleService,
  InventoryPort,
  ListShippingOptionsInput,
  ShipmentDTO,
  ShippingOptionDetailDTO,
  ShippingOptionDTO,
  ShippingPriceContext,
  ShippingProfileDTO,
  ShippingZoneDTO,
  UpdateShippingOptionInput,
  UpdateShippingZoneInput,
} from "../types.js";

export interface FulfillmentServiceDeps {
  repo: FulfillmentRepository;
  inventory: InventoryPort;
  /** 领域事件端口（可选：单测不注入时跳过发事件）。 */
  events?: (event: { name: string; data: Record<string, unknown> }) => Promise<void>;
}

/** M08 对外门面。承运商 API 不接（手填）；发货时经端口把库存预留 commit 为出库。 */
export class FulfillmentService implements IFulfillmentModuleService {
  constructor(private readonly deps: FulfillmentServiceDeps) {}

  async listShippingOptions(input: ListShippingOptionsInput): Promise<ShippingOptionDTO[]> {
    const options = await this.deps.repo.listOptionsByChannel(
      input.channelId,
      input.countryCode,
      input.profileId ?? null,
    );
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

  // ---------------------------------------------------------------- *
  // 运费配置（后台「设置 → 运费」）
  //
  // 模型照抄成熟电商（Shopify / WooCommerce / Medusa）：
  //   发货区（按国家）→ 区内运费方式（固定价 / 满额包邮）
  // 不做商品级「包邮」勾选：一件商品在多个国家、多档门槛下没有唯一运费，
  // 商品级开关只会制造互相打架的第二套口径。
  // ---------------------------------------------------------------- *

  async listShippingZones(profileId?: string | null): Promise<ShippingZoneDTO[]> {
    return this.deps.repo.listZones(profileId);
  }

  /** 见 types 注释：结账可选国家以「有启用运费方式」为准。 */
  async listDeliverableCountries(profileId?: string | null): Promise<string[]> {
    return this.deps.repo.listDeliverableCountries(profileId);
  }

  // ---------------------------------------------------------------- *
  // 运费模板（商品上架时选的就是它）
  // ---------------------------------------------------------------- *

  async listShippingProfiles(): Promise<ShippingProfileDTO[]> {
    return this.deps.repo.listProfiles();
  }

  async getDefaultProfileId(): Promise<string | null> {
    return (await this.deps.repo.findDefaultProfile())?.id ?? null;
  }

  async createShippingProfile(input: { name: string }): Promise<ShippingProfileDTO> {
    const name = input.name.trim();
    if (name.length === 0) throw invalidShippingAmount("运费模板名称不能为空");
    return this.deps.repo.insertProfile({
      id: prefixedUlid("shprof"),
      name,
      // 新模板一律非默认：默认模板由系统播种，避免商家误把通用模板改掉
      isDefault: false,
    });
  }

  async updateShippingProfile(id: string, input: { name?: string }): Promise<ShippingProfileDTO> {
    const profile = await this.deps.repo.findProfile(id);
    if (!profile) throw profileNotFound(id);
    const name = input.name === undefined ? undefined : input.name.trim();
    if (name !== undefined && name.length === 0) {
      throw invalidShippingAmount("运费模板名称不能为空");
    }
    return this.deps.repo.updateProfile(id, { name });
  }

  async deleteShippingProfile(id: string): Promise<void> {
    const profile = await this.deps.repo.findProfile(id);
    if (!profile) throw profileNotFound(id);
    if (profile.is_default) throw defaultProfileUndeletable();
    const count = await this.deps.repo.countZonesInProfile(id);
    if (count > 0) throw profileHasZones(profile.name, count);
    await this.deps.repo.softDeleteProfile(id);
  }

  async createShippingZone(input: CreateShippingZoneInput): Promise<ShippingZoneDTO> {
    const name = input.name.trim();
    if (name.length === 0) throw invalidShippingAmount("发货区名称不能为空");
    const countryCodes = this.normalizeCountries(input.countryCodes);
    const profileId = await this.resolveProfileId(input.profileId);
    await this.assertCountriesFree(countryCodes, null, profileId);
    return this.deps.repo.insertZone({
      id: prefixedUlid("zone"),
      name,
      profileId,
      countryCodes,
    });
  }

  async updateShippingZone(
    id: string,
    input: UpdateShippingZoneInput,
  ): Promise<ShippingZoneDTO> {
    const zone = await this.deps.repo.findZone(id);
    if (!zone) throw zoneNotFound(id);
    const name = input.name === undefined ? undefined : input.name.trim();
    if (name !== undefined && name.length === 0) {
      throw invalidShippingAmount("发货区名称不能为空");
    }
    const countryCodes =
      input.countryCodes === undefined ? undefined : this.normalizeCountries(input.countryCodes);
    if (countryCodes) {
      const profileId = await this.resolveProfileId(zone.profile_id);
      await this.assertCountriesFree(countryCodes, id, profileId);
    }
    return this.deps.repo.updateZone(id, { name, countryCodes });
  }

  async deleteShippingZone(id: string): Promise<void> {
    const zone = await this.deps.repo.findZone(id);
    if (!zone) throw zoneNotFound(id);
    const count = await this.deps.repo.countOptionsInZone(id);
    if (count > 0) throw zoneHasOptions(zone.name, count);
    await this.deps.repo.softDeleteZone(id);
  }

  async listShippingOptionsByZone(zoneId: string): Promise<ShippingOptionDetailDTO[]> {
    return this.deps.repo.listOptionDetailsByZone(zoneId);
  }

  async createShippingOption(
    input: CreateShippingOptionInput,
  ): Promise<ShippingOptionDetailDTO> {
    const zone = await this.deps.repo.findZone(input.zoneId);
    if (!zone) throw zoneNotFound(input.zoneId);
    const name = input.name.trim();
    if (name.length === 0) throw invalidShippingAmount("运费方式名称不能为空");
    if (input.amountMinor < 0n) throw invalidShippingAmount("运费金额不能为负");
    if (input.type !== "free_over" && input.freeOverThresholdMinor != null) {
      throw invalidShippingAmount("只有「满额包邮」可以设置免运费门槛");
    }
    const threshold =
      input.type === "free_over" ? this.requireThreshold(input.freeOverThresholdMinor) : null;

    const option = await this.deps.repo.insertOption({
      id: prefixedUlid("shipopt"),
      zoneId: input.zoneId,
      name,
      carrier: input.carrier?.trim() || null,
      type: input.type,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode.toUpperCase(),
      channelIds: input.channelIds,
    });
    if (threshold !== null) {
      await this.deps.repo.replaceFreeOverRule(option.id, prefixedUlid("shiprule"), threshold);
      return { ...option, free_over_threshold_minor: threshold };
    }
    return option;
  }

  async updateShippingOption(
    id: string,
    input: UpdateShippingOptionInput,
  ): Promise<ShippingOptionDetailDTO> {
    const current = await this.deps.repo.findOptionDetail(id);
    if (!current) throw optionNotFound(id);
    const name = input.name === undefined ? undefined : input.name.trim();
    if (name !== undefined && name.length === 0) {
      throw invalidShippingAmount("运费方式名称不能为空");
    }
    if (input.amountMinor !== undefined && input.amountMinor < 0n) {
      throw invalidShippingAmount("运费金额不能为负");
    }
    const nextType = input.type ?? current.type;

    // 类型切换时的规则清理：离开 free_over 必须删掉门槛，否则结账仍会命中旧规则。
    if (nextType === "free_over") {
      const threshold =
        input.freeOverThresholdMinor !== undefined
          ? this.requireThreshold(input.freeOverThresholdMinor)
          : current.free_over_threshold_minor;
      if (threshold === null) throw freeOverThresholdRequired();
      const updated = await this.deps.repo.updateOption(id, {
        name,
        carrier: input.carrier,
        type: input.type,
        amountMinor: input.amountMinor,
        isActive: input.isActive,
      });
      if (
        input.freeOverThresholdMinor !== undefined ||
        current.type !== "free_over" ||
        current.free_over_threshold_minor !== threshold
      ) {
        await this.deps.repo.replaceFreeOverRule(id, prefixedUlid("shiprule"), threshold);
      }
      return { ...updated, free_over_threshold_minor: threshold };
    }

    if (input.freeOverThresholdMinor != null) {
      throw invalidShippingAmount("只有「满额包邮」可以设置免运费门槛");
    }
    const updated = await this.deps.repo.updateOption(id, {
      name,
      carrier: input.carrier,
      type: input.type,
      amountMinor: input.amountMinor,
      isActive: input.isActive,
    });
    // 走到这里 nextType 必然不是 free_over：旧的满额包邮门槛要清掉，
    // 否则结账仍会命中「满 X 免运费」，商家以为已关掉。
    if (current.type === "free_over") {
      await this.deps.repo.clearFreeOverRule(id);
    }
    return { ...updated, free_over_threshold_minor: null };
  }

  async deleteShippingOption(id: string): Promise<void> {
    const option = await this.deps.repo.findOptionDetail(id);
    if (!option) throw optionNotFound(id);
    await this.deps.repo.softDeleteOption(id);
  }

  /** 国家码统一大写去重；空态即「该区不覆盖任何国家」，允许但无意义，直接拒绝。 */
  private normalizeCountries(codes: string[]): string[] {
    const set = new Set<string>();
    for (const raw of codes) {
      const code = raw.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) throw invalidShippingCountry(raw);
      set.add(code);
    }
    if (set.size === 0) throw invalidShippingCountry("(空)");
    return [...set];
  }

  /**
   * 同一模板内，一个国家只能属于一个区。
   *
   * 这是「不可绕过」的根：同一模板里两个区同时覆盖一个国家，结账会拿到两套价格，
   * 系统只能挑一个，等于给了一条便宜的口子。
   *
   * **跨模板允许重复**——这正是多模板的意义：默认模板发中国 8 元、重货模板发中国 30 元。
   * 商品属于哪个模板是确定的，所以不会同时命中。
   */
  private async assertCountriesFree(
    codes: string[],
    excludeZoneId: string | null,
    profileId: string,
  ): Promise<void> {
    const zones = await this.deps.repo.listZones(profileId);
    for (const zone of zones) {
      if (zone.id === excludeZoneId) continue;
      for (const code of codes) {
        if (zone.country_codes.includes(code)) throw countryAlreadyInZone(code, zone.name);
      }
    }
  }

  /** 未指定模板时落到默认模板；系统还没有模板则报错（不静默建）。 */
  private async resolveProfileId(profileId: string | null | undefined): Promise<string> {
    if (profileId) {
      const profile = await this.deps.repo.findProfile(profileId);
      if (!profile) throw profileNotFound(profileId);
      return profileId;
    }
    const fallback = await this.deps.repo.findDefaultProfile();
    if (!fallback) throw profileNotFound("(默认运费模板)");
    return fallback.id;
  }

  private requireThreshold(value: bigint | null | undefined): bigint {
    if (value == null || value <= 0n) throw freeOverThresholdRequired();
    return value;
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
    return { ...fulfillment, items: input.items };
  }

  async findFulfillment(id: string): Promise<FulfillmentDTO | null> {
    return this.deps.repo.findFulfillment(id);
  }

  async listByOrder(orderId: string): Promise<FulfillmentDTO[]> {
    return this.deps.repo.listByOrder(orderId);
  }

  async listFirstTrackingByOrderIds(
    orderIds: string[],
  ): Promise<Array<{ orderId: string; carrier: string; number: string }>> {
    return this.deps.repo.listFirstTrackingByOrderIds(orderIds);
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

    // 「已发货」是异步事实：发事件让订单侧按已发数量推进状态（模块间不直连）。
    if (this.deps.events) {
      await this.deps.events({
        name: "shipment.created",
        data: { orderId: fulfillment.order_id, fulfillmentId },
      });
    }
    return shipment;
  }
}
