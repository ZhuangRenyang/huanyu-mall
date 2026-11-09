import type {
  CalculatedPriceDTO,
  CreatePriceDTO,
  IPricingModuleService,
  PriceDTO,
  PriceListDTO,
  PriceListQuery,
  PriceSetDTO,
  PricingContext,
  PricingRepository,
} from "../types.js";
import { selectPrice } from "./price-calculator.js";

/** M02 对外门面（架构 §2.1）。calculatePrices 是唯一计价入口。 */
export class PricingService implements IPricingModuleService {
  constructor(private readonly repo: PricingRepository) {}

  async createPriceSet(): Promise<PriceSetDTO> {
    return this.repo.createPriceSet();
  }

  async addPrices(priceSetId: string, prices: CreatePriceDTO[]): Promise<void> {
    if (prices.length === 0) return;
    await this.repo.addPrices(priceSetId, prices);
  }

  /** 按币种批量设价：变体已有 price_set 则复用，否则新建并 link；替换该 price_set 的现有价格行。 */
  async setPrices(input: { variantId: string; prices: CreatePriceDTO[] }): Promise<{ priceSetId: string }> {
    let priceSetId = (await this.repo.priceSetIdsByVariantIds([input.variantId])).get(input.variantId);
    if (!priceSetId) {
      const created = await this.repo.createPriceSet();
      priceSetId = created.id;
      await this.repo.linkVariantPriceSet(input.variantId, priceSetId);
    }
    await this.repo.replacePricesForPriceSet(priceSetId, input.prices);
    return { priceSetId };
  }

  async calculatePrices(input: {
    variantIds: string[];
    context: PricingContext;
  }): Promise<CalculatedPriceDTO[]> {
    if (input.variantIds.length === 0) return [];

    const priceSetByVariant = await this.repo.priceSetIdsByVariantIds(input.variantIds);
    const priceSetIds = [...new Set(priceSetByVariant.values())];
    const prices = await this.repo.listPricesByPriceSetIds(priceSetIds);

    const pricesBySet = new Map<string, PriceDTO[]>();
    for (const p of prices) {
      const arr = pricesBySet.get(p.price_set_id) ?? [];
      arr.push(p);
      pricesBySet.set(p.price_set_id, arr);
    }

    const quantity = input.context.quantity ?? 1;
    const result: CalculatedPriceDTO[] = [];
    for (const [variantId, priceSetId] of priceSetByVariant) {
      const chosen = selectPrice(pricesBySet.get(priceSetId) ?? [], {
        currencyCode: input.context.currencyCode,
        quantity,
      });
      if (!chosen) continue;
      result.push({
        variantId,
        priceSetId,
        currencyCode: chosen.currency_code,
        amountMinor: chosen.amount_minor,
        compareAtAmountMinor: chosen.compare_at_amount_minor,
        priceListId: chosen.price_list_id,
      });
    }
    return result;
  }

  async listPriceLists(q?: PriceListQuery): Promise<{ items: PriceListDTO[]; count: number }> {
    return this.repo.listPriceLists(q);
  }
}
