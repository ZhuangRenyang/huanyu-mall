import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  CreatePriceDTO,
  PriceDTO,
  PriceListDTO,
  PriceListQuery,
  PriceListStatus,
  PriceListType,
  PriceSetDTO,
  PricingRepository,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzlePricingRepository implements PricingRepository {
  constructor(private readonly db: Db) {}

  async createPriceSet(): Promise<PriceSetDTO> {
    const rows = await this.db
      .insert(schema.priceSet)
      .values({ id: prefixedUlid("pset") })
      .returning();
    return { id: rows[0]!.id };
  }

  async addPrices(priceSetId: string, prices: CreatePriceDTO[]): Promise<void> {
    if (prices.length === 0) return;
    await this.db.insert(schema.price).values(
      prices.map((p) => ({
        id: prefixedUlid("prc"),
        priceSetId,
        currencyCode: p.currencyCode,
        amountMinor: p.amountMinor,
        compareAtAmountMinor: p.compareAtAmountMinor ?? null,
        priceListId: p.priceListId ?? null,
        minQuantity: p.minQuantity ?? 1,
        maxQuantity: p.maxQuantity ?? null,
      })),
    );
  }

  async listPricesByPriceSetIds(priceSetIds: string[]): Promise<PriceDTO[]> {
    if (priceSetIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.price)
      .where(and(inArray(schema.price.priceSetId, priceSetIds), isNull(schema.price.deletedAt)));
    return rows.map(toPriceDTO);
  }

  async listPriceLists(q?: PriceListQuery): Promise<{ items: PriceListDTO[]; count: number }> {
    const conditions = [isNull(schema.priceList.deletedAt)];
    if (q?.status) conditions.push(eq(schema.priceList.status, q.status));
    const rows = await this.db
      .select()
      .from(schema.priceList)
      .where(and(...conditions));
    return { items: rows.map(toPriceListDTO), count: rows.length };
  }

  async priceSetIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (variantIds.length === 0) return map;
    const inClause = sql.join(variantIds.map((id) => sql`${id}`), sql`, `);
    const res = await this.db.execute(
      sql`SELECT variant_id, price_set_id FROM variant_price_set WHERE variant_id IN (${inClause}) AND deleted_at IS NULL`,
    );
    for (const row of res.rows as Array<Record<string, unknown>>) {
      map.set(String(row.variant_id), String(row.price_set_id));
    }
    return map;
  }

  async linkVariantPriceSet(variantId: string, priceSetId: string): Promise<void> {
    await this.db.execute(
      sql`INSERT INTO variant_price_set (id, variant_id, price_set_id) VALUES (${prefixedUlid("lnk")}, ${variantId}, ${priceSetId})`,
    );
  }

  async replacePricesForPriceSet(priceSetId: string, prices: CreatePriceDTO[]): Promise<void> {
    await this.db
      .update(schema.price)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.price.priceSetId, priceSetId), isNull(schema.price.deletedAt)));
    await this.addPrices(priceSetId, prices);
  }
}

function toPriceDTO(r: typeof schema.price.$inferSelect): PriceDTO {
  return {
    id: r.id,
    price_set_id: r.priceSetId,
    currency_code: r.currencyCode,
    amount_minor: r.amountMinor,
    compare_at_amount_minor: r.compareAtAmountMinor ?? null,
    price_list_id: r.priceListId ?? null,
    min_quantity: r.minQuantity,
    max_quantity: r.maxQuantity ?? null,
  };
}

function toPriceListDTO(r: typeof schema.priceList.$inferSelect): PriceListDTO {
  return {
    id: r.id,
    name: r.name,
    type: r.type as PriceListType,
    status: r.status as PriceListStatus,
    starts_at: r.startsAt ? r.startsAt.toISOString() : null,
    ends_at: r.endsAt ? r.endsAt.toISOString() : null,
  };
}
