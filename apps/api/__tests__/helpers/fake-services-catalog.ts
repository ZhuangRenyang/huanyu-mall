/**
 * 业务模块的测试替身（mock services）——目录侧：渠道 / 商品 / 计价 / 税。
 * 与真实模块服务保持同名同参，路由层行为可被完整驱动。
 */
import { buildCheckoutCountries } from "@mall/tax";
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
  /** 可变的商品集合：批量操作会改状态/删除，测试要能看到变化。 */
  const products: Array<typeof product> = [product];
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
      // 支持状态/关键词过滤与批量改状态：批量操作测试要看到真实影响
      listProducts: async (q: {
        status?: string;
        q?: string;
        limit?: number;
        offset?: number;
      } = {}) => {
        let all = products.filter((p) => !q.status || p.status === q.status);
        if (q.q) {
          const needle = q.q.toLowerCase();
          all = all.filter(
            (p) =>
              p.title.toLowerCase().includes(needle) || p.handle.toLowerCase().includes(needle),
          );
        }
        const offset = q.offset ?? 0;
        const limit = q.limit ?? all.length;
        return { items: all.slice(offset, offset + limit), count: all.length };
      },
      countByStatus: async () => {
        const out: Record<string, number> = {};
        for (const p of products) out[p.status] = (out[p.status] ?? 0) + 1;
        return out;
      },
      bulkUpdateStatus: async (ids: string[], status: string) => {
        let n = 0;
        for (const p of products) {
          if (ids.includes(p.id)) {
            p.status = status;
            n += 1;
          }
        }
        return n;
      },
      bulkDelete: async (ids: string[]) => {
        const before = products.length;
        for (let i = products.length - 1; i >= 0; i -= 1) {
          if (ids.includes(products[i]!.id)) products.splice(i, 1);
        }
        return before - products.length;
      },
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
      // 按真实 DTO 契约回显（服务层入参 camelCase → DTO snake_case）：
      // 路由若把字段名弄错，这里就会漏字段，测试能立刻看出来
      updateProduct: async (
        _id: string,
        patch: {
          title?: string;
          subtitle?: string | null;
          status?: string;
          shippingProfileId?: string | null;
          freeShipping?: boolean;
        },
      ) => ({
        ...product,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.shippingProfileId !== undefined
          ? { shipping_profile_id: patch.shippingProfileId }
          : {}),
        ...(patch.freeShipping !== undefined ? { free_shipping: patch.freeShipping } : {}),
      }),
      replaceProductImages: async (productId: string, fileIds: string[]) => ({
        ...product,
        id: productId,
        thumbnail_file_id: fileIds[0] ?? null,
        description: null,
        images: fileIds.map((fileId, index) => ({
          id: `pimg_${index}`,
          product_id: productId,
          file_id: fileId,
          alt: null,
          sort_order: index,
          is_primary: index === 0,
        })),
        variants: [variant],
      }),
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
    // 税务替身（ADR-018）：开关 + 默认税率 + 国家覆盖，语义与真实服务一致
    tax: (() => {
      const settings = { enabled: false, tax_name: "税", prices_include_tax: true };
      const rates = new Map<string | null, { id: string; name: string; rate_bps: number }>();
      let seq = 0;
      const dto = (countryCode: string | null) => {
        const row = rates.get(countryCode);
        return row ? { ...row, country_code: countryCode } : null;
      };
      return {
        getRateForChannel: async () => ({
          id: "t",
          name: "t",
          rate_bps: 0,
          is_inclusive: true,
        }),
        getSettings: async () => ({ ...settings }),
        updateSettings: async (patch: Record<string, unknown>) => {
          Object.assign(settings, patch);
          return { ...settings };
        },
        listRates: async () =>
          [...rates.entries()]
            .map(([code, row]) => ({ ...row, country_code: code }))
            .sort((a, b) => String(a.country_code).localeCompare(String(b.country_code))),
        setDefaultRate: async (input: { name: string; rateBps: number }) => {
          const row = { id: `tax_default`, name: input.name, rate_bps: input.rateBps };
          rates.set(null, row);
          return { ...row, country_code: null };
        },
        setCountryRate: async (input: { countryCode: string; name: string; rateBps: number }) => {
          const code = input.countryCode.toUpperCase();
          const row = { id: `tax_${code}`, name: input.name, rate_bps: input.rateBps };
          rates.set(code, row);
          return { ...row, country_code: code };
        },
        deleteCountryRate: async (countryCode: string) => {
          rates.delete(countryCode.toUpperCase());
        },
        listCheckoutCountries: async () => {
          // 注意别用 rates 命名局部变量：会和闭包里的 Map 同名，触发 TDZ
          const rows = [...rates.entries()].map(([code, row]) => ({
            id: row.id,
            name: row.name,
            rate_bps: row.rate_bps,
            country_code: code,
          }));
          const defaultBps = rows.find((r) => r.country_code === null)?.rate_bps ?? 0;
          return buildCheckoutCountries(rows, settings.enabled, defaultBps);
        },
        resolveRate: async (countryCode?: string | null) => {
          const code = countryCode ? countryCode.toUpperCase() : null;
          const hit = code ? rates.get(code) : undefined;
          if (hit) return { rate_bps: hit.rate_bps, source: "country" as const };
          const fallback = rates.get(null);
          if (fallback) return { rate_bps: fallback.rate_bps, source: "default" as const };
          return { rate_bps: 0, source: "none" as const };
        },
        calculateTax: async (input: {
          lines?: Array<{ lineId: string; amountMinor: bigint }>;
          shippingMinor?: bigint;
        }) => ({
          lines: (input.lines ?? []).map((l) => ({
            lineId: l.lineId,
            taxRateBps: 0,
            taxAmountMinor: 0n,
          })),
          shippingTaxMinor: 0n,
          totalTaxMinor: 0n,
          rateSource: "none" as const,
          included_in_price: settings.prices_include_tax,
        }),
        // 供断言用：当前是否配了某国
        __rates: rates,
        __dto: dto,
        __seq: () => ++seq,
      };
    })(),
  };
}
