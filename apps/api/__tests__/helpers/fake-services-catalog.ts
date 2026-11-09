/**
 * 业务模块的测试替身（mock services）——目录侧：渠道 / 商品 / 计价 / 税。
 * 与真实模块服务保持同名同参，路由层行为可被完整驱动。
 */
import type { FakeServicesState } from "./fake-services-state.js";

export function makeFakeCatalogServices(state: FakeServicesState) {
  const channel = {
    id: "chn_cn",
    name: "cn",
    slug: "cn",
    currency_code: "CNY",
    region_id: "reg_1",
    default_locale: "zh-CN",
    market_scope: "cn",
    is_active: true,
    metadata: null,
  };
  const product = {
    id: "prod_1",
    title: "T恤",
    handle: "tee",
    subtitle: null,
    description: null,
    status: "published",
    thumbnail_file_id: null,
    product_type_id: null,
    metadata: null,
  };
  const variant = {
    id: "var_1",
    product_id: "prod_1",
    sku: "TEE-S",
    title: "S",
    options: {},
    allow_backorder: false,
    status: "published",
  };

  return {
    regionChannel: {
      listChannels: async () => [channel],
      getChannel: async () => channel,
    },
    product: {
      listProducts: async () => ({ items: [product], count: 1 }),
      listProductsWithVariants: async () => ({
        items: [{ ...product, variants: [variant] }],
        count: 1,
      }),
      retrieveProduct: async () => ({
        ...product,
        variants: [variant],
        images: [
          {
            id: "pimg_1",
            product_id: "prod_1",
            file_id: "file_1",
            alt: null,
            sort_order: 0,
            is_primary: true,
          },
        ],
      }),
      createProduct: async (input: { title: string; handle: string }) => ({
        ...product,
        title: input.title,
        handle: input.handle,
        variants: [],
        images: [],
      }),
      updateProduct: async () => product,
      deleteProduct: async () => {},
      listVariantsByIds: async () => [variant],
      resolveSellableVariants: async () => ({ items: [], count: 0 }),
      createVariant: async (_productId: string, input: { sku: string; title: string }) => ({
        ...variant,
        id: "var_new",
        sku: input.sku,
        title: input.title,
      }),
      updateVariant: async (id: string, patch: { title?: string }) => ({
        ...variant,
        id,
        title: patch.title ?? variant.title,
      }),
    },
    pricing: {
      calculatePrices: async ({ variantIds }: { variantIds: string[] }) =>
        variantIds.map((id) => ({
          variantId: id,
          priceSetId: "pset_1",
          currencyCode: "CNY",
          amountMinor: 9900n,
          compareAtAmountMinor: null,
          priceListId: null,
        })),
      createPriceSet: async () => ({ id: "pset_1" }),
      addPrices: async () => {},
      setPrices: async () => ({ priceSetId: "pset_1" }),
      listPriceLists: async () => ({ items: [], count: 0 }),
    },
    tax: {
      getRateForChannel: async () => ({
        id: "t",
        name: "t",
        rate_bps: 0,
        is_inclusive: true,
      }),
      calculateTax: async () => ({ lines: [], shippingTaxMinor: 0n, totalTaxMinor: 0n }),
    },
  };
}
