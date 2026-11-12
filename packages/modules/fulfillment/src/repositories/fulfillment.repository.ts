import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  FulfillmentDTO,
  FulfillmentItemInput,
  FulfillmentRepository,
  FulfillmentStatus,
  PriceRuleDTO,
  ShipmentDTO,
  ShippingOptionDetailDTO,
  ShippingOptionDTO,
  ShippingOptionType,
  ShippingProfileDTO,
  ShippingZoneDTO,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleFulfillmentRepository implements FulfillmentRepository {
  constructor(private readonly db: Db) {}

  async listOptionsByChannel(
    channelId: string,
    countryCode: string,
    profileId: string | null,
  ): Promise<ShippingOptionDTO[]> {
    // profileId 为空时走默认模板；两者都为空说明系统还没有模板（新装），返回空即可。
    const resolved =
      profileId ??
      (await this.findDefaultProfile())?.id ??
      null;
    if (resolved === null) return [];
    const res = await this.db.execute(
      sql`SELECT o.id, o.name, o.zone_id, o.carrier, o.type, o.amount_minor, o.currency_code, o.is_active
          FROM shipping_option o
          JOIN shipping_zone z ON z.id = o.zone_id
          JOIN shipping_option_channel lk ON lk.shipping_option_id = o.id
          WHERE lk.channel_id = ${channelId} AND o.is_active = true
            AND o.deleted_at IS NULL AND z.deleted_at IS NULL AND lk.deleted_at IS NULL
            AND z.profile_id = ${resolved}
            AND z.country_codes @> ${JSON.stringify([countryCode])}::jsonb`,
    );
    return (res.rows as Array<Record<string, unknown>>).map(toOptionDTO);
  }

  /**
   * 可下单国家：必须与 `listOptionsByChannel` 用同一套过滤条件。
   *
   * 口径一旦不一致（比如这里只查 zone、那边还要求绑渠道），就会出现
   * 「国家能选但结账算不出运费」—— 顾客点击下单才失败，等于把 bug 抛给顾客。
   */
  async listDeliverableCountries(profileId?: string | null): Promise<string[]> {
    const scope =
      profileId === undefined
        ? sql``
        : sql`AND z.profile_id = ${profileId ?? (await this.findDefaultProfile())?.id ?? null}`;
    const res = await this.db.execute(
      sql`SELECT DISTINCT jsonb_array_elements_text(z.country_codes) AS code
          FROM shipping_zone z
          JOIN shipping_option o
            ON o.zone_id = z.id AND o.is_active = true AND o.deleted_at IS NULL
          WHERE z.deleted_at IS NULL
            ${scope}
            AND EXISTS (
              SELECT 1 FROM shipping_option_channel lk
              WHERE lk.shipping_option_id = o.id AND lk.deleted_at IS NULL
            )`,
    );
    return (res.rows as Array<{ code: string }>)
      .map((r) => r.code.toUpperCase())
      .sort();
  }

  async findOption(id: string): Promise<ShippingOptionDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.shippingOption)
      .where(and(eq(schema.shippingOption.id, id), isNull(schema.shippingOption.deletedAt)))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      zone_id: r.zoneId,
      carrier: r.carrier ?? null,
      type: r.type as ShippingOptionType,
      amount_minor: r.amountMinor,
      currency_code: r.currencyCode,
      is_active: r.isActive,
    };
  }

  async listRules(optionId: string): Promise<PriceRuleDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.shippingOptionPriceRule)
      .where(
        and(
          eq(schema.shippingOptionPriceRule.shippingOptionId, optionId),
          isNull(schema.shippingOptionPriceRule.deletedAt),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      rule_type: r.ruleType as PriceRuleDTO["rule_type"],
      weight_min_g: r.weightMinG ?? null,
      weight_max_g: r.weightMaxG ?? null,
      order_over_minor: r.orderOverMinor ?? null,
      amount_minor: r.amountMinor,
    }));
  }

  // ---------------------------------------------------------------- *
  // 运费配置读写
  // ---------------------------------------------------------------- *

  // ---- 运费模板 ----

  async listProfiles(): Promise<ShippingProfileDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.shippingProfile)
      .where(isNull(schema.shippingProfile.deletedAt))
      .orderBy(schema.shippingProfile.createdAt);
    return rows.map(toProfileDTO);
  }

  async findProfile(id: string): Promise<ShippingProfileDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.shippingProfile)
      .where(and(eq(schema.shippingProfile.id, id), isNull(schema.shippingProfile.deletedAt)))
      .limit(1);
    return rows[0] ? toProfileDTO(rows[0]) : null;
  }

  async findDefaultProfile(): Promise<ShippingProfileDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.shippingProfile)
      .where(
        and(
          eq(schema.shippingProfile.isDefault, true),
          isNull(schema.shippingProfile.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toProfileDTO(rows[0]) : null;
  }

  async insertProfile(input: {
    id: string;
    name: string;
    isDefault: boolean;
  }): Promise<ShippingProfileDTO> {
    const rows = await this.db
      .insert(schema.shippingProfile)
      .values({ id: input.id, name: input.name, isDefault: input.isDefault })
      .returning();
    return toProfileDTO(rows[0]!);
  }

  async updateProfile(id: string, input: { name?: string }): Promise<ShippingProfileDTO> {
    const rows = await this.db
      .update(schema.shippingProfile)
      .set({ ...(input.name !== undefined ? { name: input.name } : {}), updatedAt: new Date() })
      .where(eq(schema.shippingProfile.id, id))
      .returning();
    return toProfileDTO(rows[0]!);
  }

  async softDeleteProfile(id: string): Promise<void> {
    await this.db
      .update(schema.shippingProfile)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.shippingProfile.id, id));
  }

  async countZonesInProfile(profileId: string): Promise<number> {
    const rows = await this.db
      .select({ id: schema.shippingZone.id })
      .from(schema.shippingZone)
      .where(
        and(eq(schema.shippingZone.profileId, profileId), isNull(schema.shippingZone.deletedAt)),
      );
    return rows.length;
  }

  async listZones(profileId?: string | null): Promise<ShippingZoneDTO[]> {
    const scope =
      profileId === undefined
        ? undefined
        : eq(
            schema.shippingZone.profileId,
            profileId ?? (await this.findDefaultProfile())?.id ?? "__none__",
          );
    const rows = await this.db
      .select()
      .from(schema.shippingZone)
      .where(scope ? and(isNull(schema.shippingZone.deletedAt), scope) : isNull(schema.shippingZone.deletedAt))
      .orderBy(schema.shippingZone.createdAt);
    return rows.map(toZoneDTO);
  }

  async findZone(id: string): Promise<ShippingZoneDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.shippingZone)
      .where(and(eq(schema.shippingZone.id, id), isNull(schema.shippingZone.deletedAt)))
      .limit(1);
    return rows[0] ? toZoneDTO(rows[0]) : null;
  }

  async insertZone(input: {
    id: string;
    name: string;
    profileId: string;
    countryCodes: string[];
  }): Promise<ShippingZoneDTO> {
    const rows = await this.db
      .insert(schema.shippingZone)
      .values({
        id: input.id,
        name: input.name,
        profileId: input.profileId,
        countryCodes: input.countryCodes,
      })
      .returning();
    return toZoneDTO(rows[0]!);
  }

  async updateZone(
    id: string,
    input: { name?: string; countryCodes?: string[] },
  ): Promise<ShippingZoneDTO> {
    const rows = await this.db
      .update(schema.shippingZone)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.countryCodes !== undefined ? { countryCodes: input.countryCodes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.shippingZone.id, id))
      .returning();
    return toZoneDTO(rows[0]!);
  }

  async softDeleteZone(id: string): Promise<void> {
    await this.db
      .update(schema.shippingZone)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.shippingZone.id, id));
  }

  async countOptionsInZone(zoneId: string): Promise<number> {
    const rows = await this.db
      .select({ id: schema.shippingOption.id })
      .from(schema.shippingOption)
      .where(
        and(
          eq(schema.shippingOption.zoneId, zoneId),
          isNull(schema.shippingOption.deletedAt),
        ),
      );
    return rows.length;
  }

  async listOptionDetailsByZone(zoneId: string): Promise<ShippingOptionDetailDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.shippingOption)
      .where(
        and(eq(schema.shippingOption.zoneId, zoneId), isNull(schema.shippingOption.deletedAt)),
      )
      .orderBy(schema.shippingOption.createdAt);
    if (rows.length === 0) return [];
    const thresholds = await this.freeOverThresholds(rows.map((r) => r.id));
    return rows.map((r) => toOptionDetailDTO(r, thresholds));
  }

  async findOptionDetail(id: string): Promise<ShippingOptionDetailDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.shippingOption)
      .where(and(eq(schema.shippingOption.id, id), isNull(schema.shippingOption.deletedAt)))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const thresholds = await this.freeOverThresholds([r.id]);
    return toOptionDetailDTO(r, thresholds);
  }

  async insertOption(input: {
    id: string;
    zoneId: string;
    name: string;
    carrier: string | null;
    type: ShippingOptionType;
    amountMinor: bigint;
    currencyCode: string;
    channelIds: string[];
  }): Promise<ShippingOptionDetailDTO> {
    const rows = await this.db
      .insert(schema.shippingOption)
      .values({
        id: input.id,
        zoneId: input.zoneId,
        name: input.name,
        carrier: input.carrier,
        type: input.type,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
      })
      .returning();
    /*
     * 关联渠道是**必须**的：结账查运费走 shipping_option_channel 内连接，
     * 少写这一行，方案在后台看得到、顾客那边直接「无可用运费」。
     */
    for (const channelId of input.channelIds) {
      await this.db.execute(
        sql`INSERT INTO shipping_option_channel (id, shipping_option_id, channel_id)
            VALUES (${prefixedUlid("lnk")}, ${input.id}, ${channelId})
            ON CONFLICT DO NOTHING`,
      );
    }
    return toOptionDetailDTO(rows[0]!, new Map<string, bigint>());
  }

  async updateOption(
    id: string,
    input: {
      name?: string;
      carrier?: string | null;
      type?: ShippingOptionType;
      amountMinor?: bigint;
      isActive?: boolean;
    },
  ): Promise<ShippingOptionDetailDTO> {
    const rows = await this.db
      .update(schema.shippingOption)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.shippingOption.id, id))
      .returning();
    const r = rows[0]!;
    const thresholds = await this.freeOverThresholds([r.id]);
    return toOptionDetailDTO(r, thresholds);
  }

  async softDeleteOption(id: string): Promise<void> {
    await this.db
      .update(schema.shippingOption)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.shippingOption.id, id));
  }

  async replaceFreeOverRule(
    optionId: string,
    ruleId: string,
    thresholdMinor: bigint,
  ): Promise<void> {
    await this.clearFreeOverRule(optionId);
    await this.db.insert(schema.shippingOptionPriceRule).values({
      id: ruleId,
      shippingOptionId: optionId,
      ruleType: "free_over",
      orderOverMinor: thresholdMinor,
      // 门槛未达成时的兜底价由 option.amount_minor 决定，规则行本身不另计费。
      amountMinor: 0n,
    });
  }

  async clearFreeOverRule(optionId: string): Promise<void> {
    await this.db
      .update(schema.shippingOptionPriceRule)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.shippingOptionPriceRule.shippingOptionId, optionId),
          eq(schema.shippingOptionPriceRule.ruleType, "free_over"),
          isNull(schema.shippingOptionPriceRule.deletedAt),
        ),
      );
  }

  /** 批量取 free_over 门槛（后台列表一次查完，避免 N+1）。 */
  private async freeOverThresholds(optionIds: string[]): Promise<Map<string, bigint>> {
    if (optionIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(schema.shippingOptionPriceRule)
      .where(
        and(
          inArray(schema.shippingOptionPriceRule.shippingOptionId, optionIds),
          eq(schema.shippingOptionPriceRule.ruleType, "free_over"),
          isNull(schema.shippingOptionPriceRule.deletedAt),
        ),
      );
    const map = new Map<string, bigint>();
    for (const r of rows) {
      if (r.orderOverMinor !== null) map.set(r.shippingOptionId, r.orderOverMinor);
    }
    return map;
  }

  async insertFulfillment(input: {
    id: string;
    orderId: string;
    stockLocationId?: string | null;
    status: FulfillmentStatus;
    reservationIds: string[];
  }): Promise<FulfillmentDTO> {
    const rows = await this.db
      .insert(schema.fulfillment)
      .values({
        id: input.id,
        orderId: input.orderId,
        stockLocationId: input.stockLocationId ?? null,
        status: input.status,
        metadata: { reservationIds: input.reservationIds },
      })
      .returning();
    return toFulfillmentDTO(rows[0]!);
  }

  async findFulfillment(id: string): Promise<FulfillmentDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.fulfillment)
      .where(and(eq(schema.fulfillment.id, id), isNull(schema.fulfillment.deletedAt)))
      .limit(1);
    if (!rows[0]) return null;
    const itemsBy = await this.itemsByFulfillmentIds([id]);
    return { ...toFulfillmentDTO(rows[0]), items: itemsBy.get(id) ?? [] };
  }

  /** 一次查出多张发货单的行项，避免 N+1。 */
  private async itemsByFulfillmentIds(
    ids: string[],
  ): Promise<Map<string, FulfillmentItemInput[]>> {
    const map = new Map<string, FulfillmentItemInput[]>();
    if (ids.length === 0) return map;
    const rows = await this.db
      .select()
      .from(schema.fulfillmentItem)
      .where(inArray(schema.fulfillmentItem.fulfillmentId, ids));
    for (const row of rows) {
      const list = map.get(row.fulfillmentId) ?? [];
      list.push({ orderLineItemId: row.orderLineItemId, quantity: row.quantity });
      map.set(row.fulfillmentId, list);
    }
    return map;
  }

  async listByOrder(orderId: string): Promise<FulfillmentDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.fulfillment)
      .where(
        and(eq(schema.fulfillment.orderId, orderId), isNull(schema.fulfillment.deletedAt)),
      )
      .orderBy(schema.fulfillment.createdAt);
    const itemsBy = await this.itemsByFulfillmentIds(rows.map((r) => r.id));
    return rows.map((r) => ({ ...toFulfillmentDTO(r), items: itemsBy.get(r.id) ?? [] }));
  }

  async insertFulfillmentItems(fulfillmentId: string, items: FulfillmentItemInput[]): Promise<void> {
    if (items.length === 0) return;
    await this.db.insert(schema.fulfillmentItem).values(
      items.map((i) => ({
        id: prefixedUlid("fulfitem"),
        fulfillmentId,
        orderLineItemId: i.orderLineItemId,
        quantity: i.quantity,
      })),
    );
  }

  async updateFulfillmentShipped(id: string, trackingLinks: Array<{ carrier: string; number: string }>): Promise<void> {
    await this.db
      .update(schema.fulfillment)
      .set({ status: "shipped", trackingLinks, updatedAt: new Date() })
      .where(eq(schema.fulfillment.id, id));
  }

  async insertShipment(input: {
    id: string;
    fulfillmentId: string;
    carrierName: string;
    trackingNumber: string;
    shippedAt: Date;
  }): Promise<ShipmentDTO> {
    const rows = await this.db
      .insert(schema.shipment)
      .values({
        id: input.id,
        fulfillmentId: input.fulfillmentId,
        carrierName: input.carrierName,
        trackingNumber: input.trackingNumber,
        shippedAt: input.shippedAt,
      })
      .returning();
    const r = rows[0]!;
    return {
      id: r.id,
      fulfillment_id: r.fulfillmentId,
      carrier_name: r.carrierName,
      tracking_number: r.trackingNumber,
      shipped_at: r.shippedAt.toISOString(),
    };
  }
}

function toOptionDTO(r: Record<string, unknown>): ShippingOptionDTO {
  return {
    id: String(r.id),
    name: String(r.name),
    zone_id: String(r.zone_id),
    carrier: (r.carrier as string | null) ?? null,
    type: r.type as ShippingOptionType,
    amount_minor: BigInt(r.amount_minor as string),
    currency_code: String(r.currency_code),
    is_active: Boolean(r.is_active),
  };
}

function toZoneDTO(r: typeof schema.shippingZone.$inferSelect): ShippingZoneDTO {
  const codes = Array.isArray(r.countryCodes) ? (r.countryCodes as string[]) : [];
  return { id: r.id, name: r.name, profile_id: r.profileId ?? null, country_codes: codes };
}

function toProfileDTO(r: typeof schema.shippingProfile.$inferSelect): ShippingProfileDTO {
  return { id: r.id, name: r.name, is_default: r.isDefault };
}

function toOptionDetailDTO(
  r: typeof schema.shippingOption.$inferSelect,
  thresholds: Map<string, bigint>,
): ShippingOptionDetailDTO {
  return {
    id: r.id,
    name: r.name,
    zone_id: r.zoneId,
    carrier: r.carrier ?? null,
    type: r.type as ShippingOptionType,
    amount_minor: r.amountMinor,
    currency_code: r.currencyCode,
    is_active: r.isActive,
    free_over_threshold_minor: thresholds.get(r.id) ?? null,
  };
}

function toFulfillmentDTO(r: typeof schema.fulfillment.$inferSelect): FulfillmentDTO {
  const meta = (r.metadata as { reservationIds?: string[] } | null) ?? {};
  return {
    id: r.id,
    order_id: r.orderId,
    stock_location_id: r.stockLocationId ?? null,
    status: r.status as FulfillmentStatus,
    reservation_ids: meta.reservationIds ?? [],
    items: [],
    tracking_links: (r.trackingLinks as Array<{ carrier: string; number: string }> | null) ?? null,
  };
}
