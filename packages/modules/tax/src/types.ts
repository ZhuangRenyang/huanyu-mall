/**
 * M09 Tax DTO 与契约（ADR-018）。
 *
 * 一期是「Channel 级扁平税率」，二期按用户要求改为：
 * **税率跟着顾客选的国家走，且后台可切换可调整**——不锁定某个税区。
 *
 * 分层：
 *   tax_settings        店铺级策略：收不收税 / 税名叫什么 / 价格含不含税
 *   tax_rate + rule     税率本体：默认税率（ruleType=default）与地区覆盖（ruleType=country）
 */

export interface TaxRateDTO {
  id: string;
  name: string;
  rate_bps: number;
  is_inclusive: boolean;
}

/** 店面可选国家/地区：带上该国家实际会用到的税率（税关着时为 0）。 */
export interface CheckoutCountryDTO {
  code: string;
  name: string;
  /** 该国实际生效税率（bps）。含税价时它是「价内税」比例。 */
  tax_rate_bps: number;
  /** 税率来源：country=单独为该国家配的；default=用默认税率；none=不收税。 */
  rate_source: "country" | "default" | "none";
}

export interface TaxSettingsDTO {
  enabled: boolean;
  tax_name: string;
  prices_include_tax: boolean;
}

/** 一条税率配置：country_code 为 null 表示「默认税率」。 */
export interface TaxRateRuleDTO {
  id: string;
  name: string;
  rate_bps: number;
  /** ISO 国家码（大写，如 CN / US）；null = 默认税率。 */
  country_code: string | null;
}

/** 解析结果：说明这条税率从哪来，便于看出「为什么收这个税」。 */
export interface ResolvedRate {
  name: string;
  rate_bps: number;
  source: "country" | "default" | "none";
}

export interface TaxLineInput {
  lineId: string;
  amountMinor: bigint;
  quantity?: number;
  /** 行级税率覆盖（bps）；缺省用解析出的税率。 */
  taxRateBps?: number;
}

export interface TaxResultLine {
  lineId: string;
  taxRateBps: number;
  taxAmountMinor: bigint;
}

export interface TaxResultDTO {
  lines: TaxResultLine[];
  shippingTaxMinor: bigint;
  totalTaxMinor: bigint;
  /** 本次实际用的税率来源，便于展示与留痕。 */
  rateSource: "country" | "default" | "none";
  /**
   * 税是否已含在价格里。
   * 含税价：合计**不再加**税（税是从价内拆出来报账的）；
   * 价外税：合计要加上税。两种口径不能混，混了就是「重复收税」。
   */
  included_in_price: boolean;
}

export interface CalculateTaxInput {
  /** 顾客收货国家码；不传或匹配不到覆盖时用默认税率。 */
  countryCode?: string | null;
  lines: TaxLineInput[];
  shippingMinor: bigint;
}

export interface TaxRepository {
  getSettings(): Promise<TaxSettingsDTO | null>;
  upsertSettings(patch: Partial<TaxSettingsDTO>): Promise<TaxSettingsDTO>;
  /** 列出全部税率配置（默认 + 各国覆盖）。 */
  listRates(): Promise<TaxRateRuleDTO[]>;
  findDefaultRate(): Promise<TaxRateRuleDTO | null>;
  findCountryRate(countryCode: string): Promise<TaxRateRuleDTO | null>;
  upsertDefaultRate(input: { name: string; rateBps: number }): Promise<TaxRateRuleDTO>;
  upsertCountryRate(input: {
    countryCode: string;
    name: string;
    rateBps: number;
  }): Promise<TaxRateRuleDTO>;
  deleteCountryRate(countryCode: string): Promise<void>;
  /** 保留：渠道级税率查询（旧调用方）。 */
  findRateByChannelId(channelId: string): Promise<TaxRateDTO | null>;
}

export interface ITaxModuleService {
  getSettings(): Promise<TaxSettingsDTO>;
  updateSettings(patch: Partial<TaxSettingsDTO>): Promise<TaxSettingsDTO>;
  listRates(): Promise<TaxRateRuleDTO[]>;
  setDefaultRate(input: { name: string; rateBps: number }): Promise<TaxRateRuleDTO>;
  setCountryRate(input: {
    countryCode: string;
    name: string;
    rateBps: number;
  }): Promise<TaxRateRuleDTO>;
  deleteCountryRate(countryCode: string): Promise<void>;
  /** 按国家解析税率：国家覆盖 → 默认 → 未配置（0）。 */
  resolveRate(countryCode?: string | null): Promise<ResolvedRate>;
  /** 店面可选国家/地区（内置常用 ∪ 已配税率），带各自实际生效税率。 */
  listCheckoutCountries(): Promise<CheckoutCountryDTO[]>;
  calculateTax(input: CalculateTaxInput): Promise<TaxResultDTO>;
}
