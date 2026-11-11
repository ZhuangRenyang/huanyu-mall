import { errors } from "@mall/core";
import { taxFor } from "./tax-calculator.js";
import type {
  CalculateTaxInput,
  ITaxModuleService,
  ResolvedRate,
  TaxRateRuleDTO,
  TaxRepository,
  TaxResultDTO,
  TaxSettingsDTO,
} from "../types.js";

const DEFAULT_SETTINGS: TaxSettingsDTO = {
  enabled: false,
  tax_name: "税",
  prices_include_tax: true,
};

/**
 * M09 对外门面（ADR-018）。
 *
 * 解析顺序：国家覆盖 → 默认税率 → 未配置（0 税）。
 * 开关关着时直接整段跳过——和营销功能同一取向，「关了就是不收」，
 * 不靠「税率填 0」这种隐式表达。
 */
export class TaxService implements ITaxModuleService {
  constructor(private readonly repo: TaxRepository) {}

  // —— 设置 ——

  async getSettings(): Promise<TaxSettingsDTO> {
    return (await this.repo.getSettings()) ?? DEFAULT_SETTINGS;
  }

  async updateSettings(patch: Partial<TaxSettingsDTO>): Promise<TaxSettingsDTO> {
    if (patch.tax_name !== undefined && patch.tax_name.trim().length === 0) {
      throw errors.validation("税名不能为空");
    }
    return this.repo.upsertSettings(patch);
  }

  // —— 税率配置 ——

  listRates(): Promise<TaxRateRuleDTO[]> {
    return this.repo.listRates();
  }

  async setDefaultRate(input: { name: string; rateBps: number }): Promise<TaxRateRuleDTO> {
    assertRate(input.rateBps);
    return this.repo.upsertDefaultRate(input);
  }

  async setCountryRate(input: {
    countryCode: string;
    name: string;
    rateBps: number;
  }): Promise<TaxRateRuleDTO> {
    const code = input.countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      throw errors.validation("国家码必须是两位字母（如 CN / US）");
    }
    assertRate(input.rateBps);
    return this.repo.upsertCountryRate({ ...input, countryCode: code });
  }

  deleteCountryRate(countryCode: string): Promise<void> {
    return this.repo.deleteCountryRate(countryCode);
  }

  // —— 解析与计算 ——

  async resolveRate(countryCode?: string | null): Promise<ResolvedRate> {
    const code = countryCode?.trim().toUpperCase();
    if (code) {
      const country = await this.repo.findCountryRate(code);
      if (country) return { name: country.name, rate_bps: country.rate_bps, source: "country" };
    }
    const fallback = await this.repo.findDefaultRate();
    if (fallback) return { name: fallback.name, rate_bps: fallback.rate_bps, source: "default" };
    return { name: "未配置税率", rate_bps: 0, source: "none" };
  }

  async calculateTax(input: CalculateTaxInput): Promise<TaxResultDTO> {
    const settings = await this.getSettings();
    // 总开关关着 = 这一单不收税，哪怕配置了税率也不生效
    if (!settings.enabled) {
      return {
        lines: input.lines.map((l) => ({
          lineId: l.lineId,
          taxRateBps: 0,
          taxAmountMinor: 0n,
        })),
        shippingTaxMinor: 0n,
        totalTaxMinor: 0n,
        rateSource: "none",
        included_in_price: settings.prices_include_tax,
      };
    }

    const resolved = await this.resolveRate(input.countryCode);
    const rateBps = resolved.rate_bps;
    const inclusive = settings.prices_include_tax;

    const lines = input.lines.map((line) => {
      const bps = line.taxRateBps ?? rateBps;
      return {
        lineId: line.lineId,
        taxRateBps: bps,
        taxAmountMinor: taxFor(line.amountMinor, bps, inclusive),
      };
    });
    const shippingTaxMinor = taxFor(input.shippingMinor, rateBps, inclusive);
    const totalTaxMinor = lines.reduce((sum, l) => sum + l.taxAmountMinor, 0n) + shippingTaxMinor;
    return {
      lines,
      shippingTaxMinor,
      totalTaxMinor,
      rateSource: resolved.source,
      included_in_price: inclusive,
    };
  }
}

function assertRate(rateBps: number): void {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
    // 10000 bps = 100%；税率不该超过 100%，填错比不填更危险
    throw errors.validation("税率必须是 0–10000 之间的整数（万分比，10000 = 100%）");
  }
}
