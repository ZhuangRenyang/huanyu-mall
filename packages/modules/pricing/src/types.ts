/** M02 Pricing DTO 与契约（对齐架构 §2.1）。金额一律 amount_minor bigint，不做汇率换算。 */

export type PriceListType = "manual" | "rule";
export type PriceListStatus = "active" | "draft";

export interface PriceSetDTO {
  id: string;
}

export interface PriceDTO {
  id: string;
  price_set_id: string;
  currency_code: string;
  amount_minor: bigint;
  compare_at_amount_minor: bigint | null;
  price_list_id: string | null;
  min_quantity: number;
  max_quantity: number | null;
}

export interface PriceListDTO {
  id: string;
  name: string;
  type: PriceListType;
  status: PriceListStatus;
  starts_at: string | null;
  ends_at: string | null;
}

export interface CreatePriceDTO {
  currencyCode: string;
  amountMinor: bigint;
  compareAtAmountMinor?: bigint | null;
  priceListId?: string | null;
  minQuantity?: number;
  maxQuantity?: number | null;
}

export interface PricingContext {
  currencyCode: string;
  channelId?: string;
  quantity?: number;
  customerGroupId?: string;
}

export interface CalculatedPriceDTO {
  variantId: string;
  priceSetId: string;
  currencyCode: string;
  amountMinor: bigint;
  compareAtAmountMinor: bigint | null;
  priceListId: string | null;
}

export interface PriceListQuery {
  status?: PriceListStatus;
}

export interface PricingRepository {
  createPriceSet(): Promise<PriceSetDTO>;
  addPrices(priceSetId: string, prices: CreatePriceDTO[]): Promise<void>;
  listPricesByPriceSetIds(priceSetIds: string[]): Promise<PriceDTO[]>;
  listPriceLists(q?: PriceListQuery): Promise<{ items: PriceListDTO[]; count: number }>;
  /** variant_price_set link：批量取 price_set_id（禁循环）。 */
  priceSetIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>>;
  linkVariantPriceSet(variantId: string, priceSetId: string): Promise<void>;
  replacePricesForPriceSet(priceSetId: string, prices: CreatePriceDTO[]): Promise<void>;
}

export interface IPricingModuleService {
  createPriceSet(): Promise<PriceSetDTO>;
  addPrices(priceSetId: string, prices: CreatePriceDTO[]): Promise<void>;
  setPrices(input: { variantId: string; prices: CreatePriceDTO[] }): Promise<{ priceSetId: string }>;
  calculatePrices(input: { variantIds: string[]; context: PricingContext }): Promise<CalculatedPriceDTO[]>;
  listPriceLists(q?: PriceListQuery): Promise<{ items: PriceListDTO[]; count: number }>;
}
