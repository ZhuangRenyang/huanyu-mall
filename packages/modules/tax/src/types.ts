/** M09 Tax DTO 与契约（对齐架构 §2.1 / PRD K3）。一期：Channel 级单一扁平税率 + 含税价，不做税区/多税率/外部 Provider。 */

export interface TaxRateDTO {
  id: string;
  name: string;
  rate_bps: number;
  is_inclusive: boolean;
}

export interface TaxLineInput {
  lineId: string;
  amountMinor: bigint;
  quantity?: number;
  /** 行级税率覆盖（bps）；缺省用渠道扁平税率。 */
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
}

export interface CalculateTaxInput {
  channelId: string;
  lines: TaxLineInput[];
  shippingMinor: bigint;
  /** 含税口径：true=价格已含税（从价内拆出税额），false=价外加税。 */
  pricesIncludeTax: boolean;
}

export interface TaxRepository {
  findRateByChannelId(channelId: string): Promise<TaxRateDTO | null>;
  createTaxRateWithChannel(input: {
    name: string;
    rateBps: number;
    isInclusive: boolean;
    channelId: string;
  }): Promise<TaxRateDTO>;
}

export interface ITaxModuleService {
  getRateForChannel(channelId: string): Promise<TaxRateDTO>;
  calculateTax(input: CalculateTaxInput): Promise<TaxResultDTO>;
}
