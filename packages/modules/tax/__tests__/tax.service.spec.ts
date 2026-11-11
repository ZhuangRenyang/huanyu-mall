import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { TaxService } from "../src/services/tax.service.js";
import { taxFor } from "../src/services/tax-calculator.js";
import type { TaxRateRuleDTO, TaxRepository, TaxSettingsDTO } from "../src/types.js";

/** 内存仓储：与 SQL 语义一致（默认 + 国家覆盖）。 */
class InMemoryTaxRepository implements TaxRepository {
  settings: TaxSettingsDTO | null = null;
  rules: TaxRateRuleDTO[] = [];
  private counter = 0;

  async getSettings() {
    return this.settings ? { ...this.settings } : null;
  }
  async upsertSettings(patch: Partial<TaxSettingsDTO>): Promise<TaxSettingsDTO> {
    this.settings = {
      enabled: patch.enabled ?? this.settings?.enabled ?? false,
      tax_name: patch.tax_name ?? this.settings?.tax_name ?? "税",
      prices_include_tax: patch.prices_include_tax ?? this.settings?.prices_include_tax ?? true,
    };
    return { ...this.settings };
  }
  async listRates() {
    return this.rules.map((r) => ({ ...r }));
  }
  async findDefaultRate() {
    return this.rules.find((r) => r.country_code === null) ?? null;
  }
  async findCountryRate(countryCode: string) {
    const code = countryCode.toUpperCase();
    return this.rules.find((r) => r.country_code === code) ?? null;
  }
  async upsertDefaultRate(input: { name: string; rateBps: number }) {
    return this.upsert(null, input);
  }
  async upsertCountryRate(input: { countryCode: string; name: string; rateBps: number }) {
    return this.upsert(input.countryCode.toUpperCase(), input);
  }
  private upsert(countryCode: string | null, input: { name: string; rateBps: number }) {
    const existing = this.rules.find((r) => r.country_code === countryCode);
    if (existing) {
      existing.name = input.name;
      existing.rate_bps = input.rateBps;
      return { ...existing };
    }
    const row: TaxRateRuleDTO = {
      id: `taxrate_${++this.counter}`,
      name: input.name,
      rate_bps: input.rateBps,
      country_code: countryCode,
    };
    this.rules.push(row);
    return { ...row };
  }
  async deleteCountryRate(countryCode: string) {
    const code = countryCode.toUpperCase();
    this.rules = this.rules.filter((r) => r.country_code !== code);
  }
  async findRateByChannelId() {
    return null;
  }
}

async function setup(opts?: {
  enabled?: boolean;
  pricesIncludeTax?: boolean;
  defaultBps?: number;
  countries?: Record<string, number>;
}) {
  const repo = new InMemoryTaxRepository();
  const service = new TaxService(repo);
  await service.updateSettings({
    enabled: opts?.enabled ?? true,
    tax_name: "增值税",
    prices_include_tax: opts?.pricesIncludeTax ?? true,
  });
  if (opts?.defaultBps !== undefined) {
    await service.setDefaultRate({ name: "标准税率", rateBps: opts.defaultBps });
  }
  for (const [code, bps] of Object.entries(opts?.countries ?? {})) {
    await service.setCountryRate({ countryCode: code, name: `${code} 税率`, rateBps: bps });
  }
  return { repo, service };
}

describe("税率解析（ADR-018：国家覆盖 → 默认 → 无）", () => {
  it("有国家覆盖用覆盖，没有则用默认", async () => {
    const { service } = await setup({ defaultBps: 1000, countries: { US: 500 } });

    expect(await service.resolveRate("US")).toMatchObject({ rate_bps: 500, source: "country" });
    expect(await service.resolveRate("JP")).toMatchObject({ rate_bps: 1000, source: "default" });
    expect(await service.resolveRate(null)).toMatchObject({ rate_bps: 1000, source: "default" });
  });

  it("既无覆盖也无默认 → 0 税（source=none）", async () => {
    const { service } = await setup();
    expect(await service.resolveRate("CN")).toEqual({
      name: "未配置税率",
      rate_bps: 0,
      source: "none",
    });
  });

  it("国家码大小写不敏感；非法国家码与越界税率被拒", async () => {
    const { service } = await setup({ countries: { CN: 1300 } });
    expect((await service.resolveRate("cn")).rate_bps).toBe(1300);
    await expect(
      service.setCountryRate({ countryCode: "CHN", name: "x", rateBps: 100 }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      service.setCountryRate({ countryCode: "CN", name: "x", rateBps: 20000 }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("删除国家覆盖后回落默认", async () => {
    const { service } = await setup({ defaultBps: 1000, countries: { US: 500 } });
    await service.deleteCountryRate("US");
    expect(await service.resolveRate("US")).toMatchObject({ rate_bps: 1000, source: "default" });
  });
});

describe("计税口径（含税 / 价外）", () => {
  it("含税价：从价内拆税，且 included_in_price=true（合计不再加）", async () => {
    const { service } = await setup({ defaultBps: 1300, pricesIncludeTax: true });
    const result = await service.calculateTax({
      countryCode: "CN",
      lines: [{ lineId: "li_1", amountMinor: 11300n }],
      shippingMinor: 0n,
    });
    expect(result.lines[0]!.taxAmountMinor).toBe(1300n);
    expect(result.totalTaxMinor).toBe(1300n);
    expect(result.included_in_price).toBe(true);
  });

  it("价外税：额外加税，included_in_price=false", async () => {
    const { service } = await setup({ defaultBps: 1300, pricesIncludeTax: false });
    const result = await service.calculateTax({
      countryCode: "CN",
      lines: [{ lineId: "li_1", amountMinor: 10000n }],
      shippingMinor: 800n,
    });
    expect(result.lines[0]!.taxAmountMinor).toBe(1300n);
    expect(result.shippingTaxMinor).toBe(104n);
    expect(result.totalTaxMinor).toBe(1404n);
    expect(result.included_in_price).toBe(false);
  });

  it("行级税率覆盖优先于解析出的税率", async () => {
    const { service } = await setup({ defaultBps: 1000, pricesIncludeTax: false });
    const result = await service.calculateTax({
      countryCode: "CN",
      lines: [
        { lineId: "li_1", amountMinor: 10000n },
        { lineId: "li_2", amountMinor: 10000n, taxRateBps: 0 },
      ],
      shippingMinor: 0n,
    });
    expect(result.lines[0]!.taxAmountMinor).toBe(1000n);
    expect(result.lines[1]!.taxAmountMinor).toBe(0n);
    expect(result.lines[1]!.taxRateBps).toBe(0);
    expect(result.totalTaxMinor).toBe(1000n);
  });

  it("总开关关闭：即使配了税率也整段不收税", async () => {
    const { service } = await setup({ defaultBps: 1300, enabled: false });
    const result = await service.calculateTax({
      countryCode: "CN",
      lines: [{ lineId: "li_1", amountMinor: 10000n }],
      shippingMinor: 800n,
    });
    expect(result.totalTaxMinor).toBe(0n);
    expect(result.rateSource).toBe("none");
    expect(result.lines[0]!.taxRateBps).toBe(0);
  });
});

describe("taxFor 边界", () => {
  it("0 税率 / 0 金额返回 0", () => {
    expect(taxFor(0n, 1300, true)).toBe(0n);
    expect(taxFor(10000n, 0, true)).toBe(0n);
    expect(taxFor(10000n, 0, false)).toBe(0n);
  });

  it("四舍五入到整数分（bigint，无浮点）", () => {
    // 3333 分 × 13% 价外 = 433.29 → 433
    expect(taxFor(3333n, 1300, false)).toBe(433n);
    // 含税拆税：3333 × 1300 / 11300 = 383.3 → 383
    expect(taxFor(3333n, 1300, true)).toBe(383n);
  });
});
