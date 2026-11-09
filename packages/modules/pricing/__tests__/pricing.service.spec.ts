import { describe, expect, it } from "vitest";
import { prefixedUlid } from "@mall/core";
import { PricingService } from "../src/services/pricing.service.js";
import type {
  CreatePriceDTO,
  PriceDTO,
  PriceListDTO,
  PriceListQuery,
  PriceSetDTO,
  PricingRepository,
} from "../src/types.js";

class InMemoryPricingRepository implements PricingRepository {
  readonly priceSets: PriceSetDTO[] = [];
  readonly prices: PriceDTO[] = [];
  readonly priceLists: PriceListDTO[] = [];
  readonly variantPriceSet = new Map<string, string>();

  async createPriceSet(): Promise<PriceSetDTO> {
    const ps = { id: prefixedUlid("pset") };
    this.priceSets.push(ps);
    return ps;
  }
  async addPrices(priceSetId: string, prices: CreatePriceDTO[]): Promise<void> {
    for (const p of prices) {
      this.prices.push({
        id: prefixedUlid("prc"),
        price_set_id: priceSetId,
        currency_code: p.currencyCode,
        amount_minor: p.amountMinor,
        compare_at_amount_minor: p.compareAtAmountMinor ?? null,
        price_list_id: p.priceListId ?? null,
        min_quantity: p.minQuantity ?? 1,
        max_quantity: p.maxQuantity ?? null,
      });
    }
  }
  async listPricesByPriceSetIds(priceSetIds: string[]): Promise<PriceDTO[]> {
    const set = new Set(priceSetIds);
    return this.prices.filter((p) => set.has(p.price_set_id));
  }
  async listPriceLists(q?: PriceListQuery): Promise<{ items: PriceListDTO[]; count: number }> {
    const items = q?.status ? this.priceLists.filter((l) => l.status === q.status) : this.priceLists;
    return { items, count: items.length };
  }
  async priceSetIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const id of variantIds) {
      const ps = this.variantPriceSet.get(id);
      if (ps) map.set(id, ps);
    }
    return map;
  }
}

async function setup() {
  const repo = new InMemoryPricingRepository();
  const service = new PricingService(repo);
  const priceSet = await service.createPriceSet();
  await service.addPrices(priceSet.id, [
    { currencyCode: "CNY", amountMinor: 10000n, minQuantity: 1 },
    { currencyCode: "CNY", amountMinor: 9000n, minQuantity: 10 },
    { currencyCode: "USD", amountMinor: 1400n, minQuantity: 1 },
  ]);
  repo.variantPriceSet.set("var_a", priceSet.id);
  return { repo, service, priceSet };
}

describe("PricingService.calculatePrices（M02 唯一计价入口）", () => {
  it("按币种定价：CNY vs USD 取各自价格", async () => {
    const { service } = await setup();
    const cny = await service.calculatePrices({ variantIds: ["var_a"], context: { currencyCode: "CNY" } });
    expect(cny[0]?.amountMinor).toBe(10000n);
    expect(cny[0]?.currencyCode).toBe("CNY");

    const usd = await service.calculatePrices({ variantIds: ["var_a"], context: { currencyCode: "USD" } });
    expect(usd[0]?.amountMinor).toBe(1400n);
  });

  it("按数量阶梯定价：quantity>=10 命中低档", async () => {
    const { service } = await setup();
    const q1 = await service.calculatePrices({
      variantIds: ["var_a"],
      context: { currencyCode: "CNY", quantity: 1 },
    });
    expect(q1[0]?.amountMinor).toBe(10000n);

    const q10 = await service.calculatePrices({
      variantIds: ["var_a"],
      context: { currencyCode: "CNY", quantity: 10 },
    });
    expect(q10[0]?.amountMinor).toBe(9000n);
  });

  it("无匹配币种返回空；无 price_set 的变体跳过", async () => {
    const { service } = await setup();
    const jpy = await service.calculatePrices({ variantIds: ["var_a"], context: { currencyCode: "JPY" } });
    expect(jpy).toHaveLength(0);

    const unknown = await service.calculatePrices({ variantIds: ["var_unknown"], context: { currencyCode: "CNY" } });
    expect(unknown).toHaveLength(0);
  });
});
