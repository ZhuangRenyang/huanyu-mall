import { and, eq, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type { TaxRateDTO, TaxRepository } from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleTaxRepository implements TaxRepository {
  constructor(private readonly db: Db) {}

  async findRateByChannelId(channelId: string): Promise<TaxRateDTO | null> {
    const rows = await this.db
      .select({ rate: schema.taxRate })
      .from(schema.taxRateRule)
      .innerJoin(schema.taxRate, eq(schema.taxRate.id, schema.taxRateRule.taxRateId))
      .where(
        and(
          eq(schema.taxRateRule.ruleType, "channel"),
          eq(schema.taxRateRule.ruleValue, channelId),
          isNull(schema.taxRateRule.deletedAt),
          isNull(schema.taxRate.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.rate ? toTaxRateDTO(rows[0].rate) : null;
  }

  async createTaxRateWithChannel(input: {
    name: string;
    rateBps: number;
    isInclusive: boolean;
    channelId: string;
  }): Promise<TaxRateDTO> {
    const rateRows = await this.db
      .insert(schema.taxRate)
      .values({ id: prefixedUlid("taxrate"), name: input.name, rateBps: input.rateBps, isInclusive: input.isInclusive })
      .returning();
    const rate = rateRows[0]!;

    await this.db.insert(schema.taxRateRule).values({
      id: prefixedUlid("taxr"),
      taxRateId: rate.id,
      ruleType: "channel",
      ruleValue: input.channelId,
    });

    // links 层：tax_rate_channel（N:1，一期一渠道一税率）
    await this.db.execute(
      sql`INSERT INTO tax_rate_channel (id, tax_rate_id, channel_id) VALUES (${prefixedUlid("lnk")}, ${rate.id}, ${input.channelId})`,
    );

    return toTaxRateDTO(rate);
  }
}

function toTaxRateDTO(r: typeof schema.taxRate.$inferSelect): TaxRateDTO {
  return { id: r.id, name: r.name, rate_bps: r.rateBps, is_inclusive: r.isInclusive };
}
