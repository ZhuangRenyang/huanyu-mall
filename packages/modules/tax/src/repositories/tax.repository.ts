import { and, eq, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  TaxRateDTO,
  TaxRateRuleDTO,
  TaxRepository,
  TaxSettingsDTO,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

/**
 * 税务仓储。
 *
 * 税率本体复用一期的 `tax_rate` + `tax_rate_rule`：
 *   ruleType='default'  ruleValue='*'        默认税率
 *   ruleType='country'  ruleValue='<国家码>'  地区覆盖
 * 「默认 + 覆盖」是同一张表里的两行，不会出现两处口径不一致。
 */
export class DrizzleTaxRepository implements TaxRepository {
  constructor(private readonly db: Db) {}

  // —— 设置 ——

  async getSettings(): Promise<TaxSettingsDTO | null> {
    const rows = await this.db.select().from(schema.taxSettings).limit(1);
    return rows[0]
      ? {
          enabled: rows[0].enabled,
          tax_name: rows[0].taxName,
          prices_include_tax: rows[0].pricesIncludeTax,
        }
      : null;
  }

  async upsertSettings(patch: Partial<TaxSettingsDTO>): Promise<TaxSettingsDTO> {
    const current = (await this.getSettings()) ??
      { enabled: false, tax_name: "税", prices_include_tax: true };
    const values = {
      id: "tax_default",
      enabled: patch.enabled ?? current.enabled,
      taxName: patch.tax_name ?? current.tax_name,
      pricesIncludeTax: patch.prices_include_tax ?? current.prices_include_tax,
      updatedAt: new Date(),
    };
    const rows = await this.db
      .insert(schema.taxSettings)
      .values(values)
      .onConflictDoUpdate({ target: schema.taxSettings.id, set: values })
      .returning();
    return {
      enabled: rows[0]!.enabled,
      tax_name: rows[0]!.taxName,
      prices_include_tax: rows[0]!.pricesIncludeTax,
    };
  }

  // —— 税率（默认 + 地区覆盖）——

  async listRates(): Promise<TaxRateRuleDTO[]> {
    const rows = await this.db
      .select({ rule: schema.taxRateRule, rate: schema.taxRate })
      .from(schema.taxRateRule)
      .innerJoin(schema.taxRate, eq(schema.taxRate.id, schema.taxRateRule.taxRateId))
      .where(
        and(
          sql`${schema.taxRateRule.ruleType} IN ('default', 'country')`,
          isNull(schema.taxRateRule.deletedAt),
          isNull(schema.taxRate.deletedAt),
        ),
      )
      .orderBy(schema.taxRateRule.ruleType, schema.taxRateRule.ruleValue);
    return rows.map((r) => ({
      id: r.rate.id,
      name: r.rate.name,
      rate_bps: r.rate.rateBps,
      country_code: r.rule.ruleType === "country" ? r.rule.ruleValue : null,
    }));
  }

  async findDefaultRate(): Promise<TaxRateRuleDTO | null> {
    return this.findRateByRule("default", "*");
  }

  async findCountryRate(countryCode: string): Promise<TaxRateRuleDTO | null> {
    return this.findRateByRule("country", countryCode.toUpperCase());
  }

  private async findRateByRule(
    ruleType: string,
    ruleValue: string,
  ): Promise<TaxRateRuleDTO | null> {
    const rows = await this.db
      .select({ rule: schema.taxRateRule, rate: schema.taxRate })
      .from(schema.taxRateRule)
      .innerJoin(schema.taxRate, eq(schema.taxRate.id, schema.taxRateRule.taxRateId))
      .where(
        and(
          eq(schema.taxRateRule.ruleType, ruleType),
          eq(schema.taxRateRule.ruleValue, ruleValue),
          isNull(schema.taxRateRule.deletedAt),
          isNull(schema.taxRate.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.rate.id,
      name: row.rate.name,
      rate_bps: row.rate.rateBps,
      country_code: row.rule.ruleType === "country" ? row.rule.ruleValue : null,
    };
  }

  async upsertDefaultRate(input: { name: string; rateBps: number }): Promise<TaxRateRuleDTO> {
    return this.upsertRule("default", "*", input);
  }

  async upsertCountryRate(input: {
    countryCode: string;
    name: string;
    rateBps: number;
  }): Promise<TaxRateRuleDTO> {
    return this.upsertRule("country", input.countryCode.toUpperCase(), input);
  }

  private async upsertRule(
    ruleType: string,
    ruleValue: string,
    input: { name: string; rateBps: number },
  ): Promise<TaxRateRuleDTO> {
    const existing = await this.findRateByRule(ruleType, ruleValue);
    if (existing) {
      const rows = await this.db
        .update(schema.taxRate)
        .set({ name: input.name, rateBps: input.rateBps, updatedAt: new Date() })
        .where(eq(schema.taxRate.id, existing.id))
        .returning();
      return {
        id: rows[0]!.id,
        name: rows[0]!.name,
        rate_bps: rows[0]!.rateBps,
        country_code: ruleType === "country" ? ruleValue : null,
      };
    }
    const rateRows = await this.db
      .insert(schema.taxRate)
      .values({
        id: prefixedUlid("taxrate"),
        name: input.name,
        rateBps: input.rateBps,
        // 含税口径由 tax_settings.prices_include_tax 统一决定，这列只保持兼容
        isInclusive: true,
      })
      .returning();
    await this.db.insert(schema.taxRateRule).values({
      id: prefixedUlid("taxr"),
      taxRateId: rateRows[0]!.id,
      ruleType,
      ruleValue,
    });
    return {
      id: rateRows[0]!.id,
      name: rateRows[0]!.name,
      rate_bps: rateRows[0]!.rateBps,
      country_code: ruleType === "country" ? ruleValue : null,
    };
  }

  async deleteCountryRate(countryCode: string): Promise<void> {
    const code = countryCode.toUpperCase();
    // 只软删规则：税率行留着，历史订单的 tax_rate_bps 快照不受影响
    await this.db
      .update(schema.taxRateRule)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(schema.taxRateRule.ruleType, "country"), eq(schema.taxRateRule.ruleValue, code)),
      );
  }

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
    const r = rows[0]?.rate;
    return r ? { id: r.id, name: r.name, rate_bps: r.rateBps, is_inclusive: r.isInclusive } : null;
  }
}
