import { and, eq, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  FulfillmentDTO,
  FulfillmentItemInput,
  FulfillmentRepository,
  FulfillmentStatus,
  PriceRuleDTO,
  ShipmentDTO,
  ShippingOptionDTO,
  ShippingOptionType,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleFulfillmentRepository implements FulfillmentRepository {
  constructor(private readonly db: Db) {}

  async listOptionsByChannel(channelId: string, countryCode: string): Promise<ShippingOptionDTO[]> {
    const res = await this.db.execute(
      sql`SELECT o.id, o.name, o.zone_id, o.carrier, o.type, o.amount_minor, o.currency_code, o.is_active
          FROM shipping_option o
          JOIN shipping_zone z ON z.id = o.zone_id
          JOIN shipping_option_channel lk ON lk.shipping_option_id = o.id
          WHERE lk.channel_id = ${channelId} AND o.is_active = true
            AND o.deleted_at IS NULL AND z.deleted_at IS NULL AND lk.deleted_at IS NULL
            AND z.country_codes @> ${JSON.stringify([countryCode])}::jsonb`,
    );
    return (res.rows as Array<Record<string, unknown>>).map(toOptionDTO);
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

  async insertFulfillment(input: {
    id: string;
    orderId: string;
    status: FulfillmentStatus;
    reservationIds: string[];
  }): Promise<FulfillmentDTO> {
    const rows = await this.db
      .insert(schema.fulfillment)
      .values({
        id: input.id,
        orderId: input.orderId,
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
    return rows[0] ? toFulfillmentDTO(rows[0]) : null;
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

function toFulfillmentDTO(r: typeof schema.fulfillment.$inferSelect): FulfillmentDTO {
  const meta = (r.metadata as { reservationIds?: string[] } | null) ?? {};
  return {
    id: r.id,
    order_id: r.orderId,
    status: r.status as FulfillmentStatus,
    reservation_ids: meta.reservationIds ?? [],
    tracking_links: (r.trackingLinks as Array<{ carrier: string; number: string }> | null) ?? null,
  };
}
