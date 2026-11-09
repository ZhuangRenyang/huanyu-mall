import { describe, expect, it } from "vitest";
import { TaxService } from "../src/services/tax.service.js";
import { taxFor } from "../src/services/tax-calculator.js";
import type { TaxRateDTO, TaxRepository } from "../src/types.js";

class InMemoryTaxRepository implements TaxRepository {
  readonly ratesByChannel = new Map<string, TaxRateDTO>();
  private counter = 0;

  async findRateByChannelId(channelId: string): Promise<TaxRateDTO | null> {
    return this.ratesByChannel.get(channelId) ?? null;
  }
  async createTaxRateWithChannel(input: {
    name: string;
    rateBps: number;
    isInclusive: boolean;
    channelId: string;
  }): Promise<TaxRateDTO> {
    const rate: TaxRateDTO = {
      id: `taxrate_${++this.counter}`,
      name: input.name,
      rate_bps: input.rateBps,
      is_inclusive: input.isInclusive,
    };
    this.ratesByChannel.set(input.channelId, rate);
    return rate;
  }
}

async function setup(rateBps = 1300, isInclusive = true) {
  const repo = new InMemoryTaxRepository();
  const service = new TaxService(repo);
  await repo.createTaxRateWithChannel({ name: "标准税率", rateBps, isInclusive, channelId: "chn_cn" });
  return { repo, service };
}

describe("TaxService（M09，扁平税率 + 含税/不含税）", () => {
  it("getRateForChannel 命中 / 未配置返回 0 税率", async () => {
    const { service } = await setup(1300);
    const rate = await service.getRateForChannel("chn_cn");
    expect(rate.rate_bps).toBe(1300);
    const none = await service.getRateForChannel("chn_us");
    expect(none.rate_bps).toBe(0);
  });

  it("含税价口径：从价内拆出税额（11300 → 1300）", async () => {
    const { service } = await setup(1300, true);
    const res = await service.calculateTax({
      channelId: "chn_cn",
      pricesIncludeTax: true,
      lines: [{ lineId: "li_1", amountMinor: 11300n }],
      shippingMinor: 1130n,
    });
    expect(res.lines[0]?.taxAmountMinor).toBe(1300n);
    expect(res.shippingTaxMinor).toBe(130n);
    expect(res.totalTaxMinor).toBe(1430n);
  });

  it("不含税口径：价外加税（10000 → 1300），运费加税（800 → 104）", async () => {
    const { service } = await setup(1300, false);
    const res = await service.calculateTax({
      channelId: "chn_cn",
      pricesIncludeTax: false,
      lines: [{ lineId: "li_1", amountMinor: 10000n }],
      shippingMinor: 800n,
    });
    expect(res.lines[0]?.taxAmountMinor).toBe(1300n);
    expect(res.shippingTaxMinor).toBe(104n);
  });

  it("行级税率覆盖 + 行级税额汇总准确（bigint 整数）", async () => {
    const { service } = await setup(1300, false);
    const res = await service.calculateTax({
      channelId: "chn_cn",
      pricesIncludeTax: false,
      lines: [
        { lineId: "li_1", amountMinor: 10000n },
        { lineId: "li_2", amountMinor: 5000n, taxRateBps: 900 },
      ],
      shippingMinor: 0n,
    });
    expect(res.lines[0]?.taxAmountMinor).toBe(1300n);
    expect(res.lines[1]?.taxAmountMinor).toBe(450n); // 5000 * 9%
    expect(res.totalTaxMinor).toBe(1750n);
  });

  it("taxFor 边界：0 税率 / 0 金额返回 0", () => {
    expect(taxFor(10000n, 0, false)).toBe(0n);
    expect(taxFor(0n, 1300, false)).toBe(0n);
  });
});
