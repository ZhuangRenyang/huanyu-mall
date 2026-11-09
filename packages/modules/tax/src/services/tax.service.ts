import { taxFor } from "./tax-calculator.js";
import type {
  CalculateTaxInput,
  ITaxModuleService,
  TaxRateDTO,
  TaxRepository,
  TaxResultDTO,
} from "../types.js";

const ZERO_RATE: TaxRateDTO = { id: "none", name: "未配置税率", rate_bps: 0, is_inclusive: true };

/** M09 对外门面。一期扁平税率；税额行级计算，供 Order 快照冻结。 */
export class TaxService implements ITaxModuleService {
  constructor(private readonly repo: TaxRepository) {}

  async getRateForChannel(channelId: string): Promise<TaxRateDTO> {
    return (await this.repo.findRateByChannelId(channelId)) ?? ZERO_RATE;
  }

  async calculateTax(input: CalculateTaxInput): Promise<TaxResultDTO> {
    const rate = await this.getRateForChannel(input.channelId);
    const lines = input.lines.map((line) => {
      const rateBps = line.taxRateBps ?? rate.rate_bps;
      return {
        lineId: line.lineId,
        taxRateBps: rateBps,
        taxAmountMinor: taxFor(line.amountMinor, rateBps, input.pricesIncludeTax),
      };
    });
    const shippingTaxMinor = taxFor(input.shippingMinor, rate.rate_bps, input.pricesIncludeTax);
    const totalTaxMinor = lines.reduce((sum, l) => sum + l.taxAmountMinor, 0n) + shippingTaxMinor;
    return { lines, shippingTaxMinor, totalTaxMinor };
  }
}
