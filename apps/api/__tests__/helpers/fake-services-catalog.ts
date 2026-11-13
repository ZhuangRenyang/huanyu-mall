/**
 * 业务模块的测试替身（mock services）——目录侧：渠道 / 商品 / 计价 / 税。
 * 与真实模块服务保持同名同参，路由层行为可被完整驱动。
 */
import { buildCheckoutCountries } from "@mall/tax";
import { DomainError } from "@mall/core";
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

  /** 到货提醒（ADR-059）：内存数组，够验登记与幂等。 */
  const stockAlerts: Array<{
    id: string;
    product_id: string;
    variant_id: string;
    email: string;
    customer_id: string | null;
    notified_at: Date | null;
    created_at: Date;
  }> = [];

  return {
    regionChannel: {
      listChannels: async () => [channel],
      getChannel: async () => channel,
    },
    product: {
      /*
       * 库存页的「N 人等到货」：假库存行的 sku 是 SKU-1，
       * 这里把它对到 var_1，人数取 registered（测试可调）。
       */
      /*
       * 购物车失效判定（ADR-062）：默认全部可买，
       * 用例用 state.unpurchasableVariantIds 指定「已下架」的那几个。
       */
      purchasableVariantIds: async (variantIds: string[]) =>
        variantIds.filter((id) => !(state.unpurchasableVariantIds ?? []).includes(id)),
      variantIdsBySkus: async (skus: string[]) => {
        const out: Record<string, string> = {};
        for (const sku of skus) if (sku === "SKU-1") out[sku] = "var_1";
        return out;
      },
      countPendingStockAlerts: async (variantIds: string[]) => {
        const out: Record<string, number> = {};
        for (const id of variantIds) if (id === "var_1") out[id] = stockAlerts.length;
        return out;
      },
      /*
       * 到货提醒（ADR-059）：内存版，够跑「登记 → 幂等 → 回显」契约。
       * 「补货后发邮件」那条链路由 workflows 的订阅者测试守，不在这一层。
       */
      subscribeStockAlert: async (input: {
        productId: string;
        variantId: string;
        email: string;
        customerId?: string | null;
      }) => {
        if (input.productId !== "prod_1") {
          throw new DomainError({ code: 30001, message: `商品不存在：${input.productId}` });
        }
        if (input.variantId !== "var_1") {
          throw new DomainError({ code: 30001, message: `变体不存在：${input.variantId}` });
        }
        const existing = stockAlerts.find(
          (a) => a.variant_id === input.variantId && a.email === input.email,
        );
        if (existing) {
          // 与真实仓储同契约（ADR-069）：重新登记 = 刷新有效期 + 清掉已通知标记
          existing.created_at = new Date();
          existing.notified_at = null;
          return existing;
        }
        const alert = {
          id: `salt_${stockAlerts.length + 1}`,
          product_id: input.productId,
          variant_id: input.variantId,
          email: input.email,
          customer_id: input.customerId ?? null,
          notified_at: null,
          created_at: new Date(),
        };
        stockAlerts.push(alert);
        return alert;
      },
      // 支持状态/关键词过滤与批量改状态：批量操作测试要看到真实影响
      listProducts: async (q: {
        status?: string;
        q?: string;
        handle?: string;
        ids?: string[];
        limit?: number;
        offset?: number;
      } = {}) => {
        let all = products.filter((p) => !q.status || p.status === q.status);
        // ids 过滤与真实 repo 同口径：空数组 = 空结果（不是「不过滤」）
        if (q.ids) all = all.filter((p) => q.ids!.includes(p.id));
        if (q.handle) all = all.filter((p) => p.handle === q.handle);
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
      listProductsWithVariants: async (q: { ids?: string[]; status?: string } = {}) => {
        // 收藏列表按 ids 取卡片：不认 ids 的话测试里会拿到全店商品
        if (q.ids && !q.ids.includes(product.id)) return { items: [], count: 0 };
        if (q.status && q.status !== product.status) return { items: [], count: 0 };
        return { items: [{ ...product, variants: [variant] }], count: 1 };
      },
      retrieveProduct: async () => ({
        ...product,
        variants: [variant],
        category_ids: ["cat_1"],
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
        category_ids: [],
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
          categoryIds?: string[];
        },
      ) => ({
        ...product,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.shippingProfileId !== undefined
          ? { shipping_profile_id: patch.shippingProfileId }
          : {}),
        ...(patch.freeShipping !== undefined ? { free_shipping: patch.freeShipping } : {}),
        ...(patch.categoryIds !== undefined ? { category_ids: patch.categoryIds } : {}),
      }),
      // —— 分类（ADR-028）：状态放在 state 里，改完能读回来 ——
      listCategories: async () => state.categories.map((c) => ({ ...c })),
      createCategory: async (input: {
        name: string;
        handle?: string;
        parentId?: string | null;
        sortOrder?: number;
      }) => {
        const created = {
          id: `cat_${state.categories.length + 1}`,
          name: input.name,
          handle: input.handle ?? input.name,
          parent_id: input.parentId ?? null,
          sort_order: input.sortOrder ?? 0,
          product_count: 0,
        };
        state.categories.push(created);
        return { ...created };
      },
      updateCategory: async (
        id: string,
        patch: { name?: string; handle?: string; parentId?: string | null; sortOrder?: number },
      ) => {
        const row = state.categories.find((c) => c.id === id);
        if (!row) throw new DomainError({ code: 30001, message: `分类不存在：${id}` });
        if (patch.name !== undefined) row.name = patch.name;
        if (patch.handle !== undefined) row.handle = patch.handle;
        if (patch.parentId !== undefined) row.parent_id = patch.parentId;
        if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
        return { ...row };
      },
      deleteCategory: async (id: string) => {
        const row = state.categories.find((c) => c.id === id);
        if (!row) throw new DomainError({ code: 30001, message: `分类不存在：${id}` });
        if (row.product_count > 0) {
          throw new DomainError({ code: 30003, message: `该分类下还有 ${row.product_count} 个商品` });
        }
        state.categories = state.categories.filter((c) => c.id !== id);
      },
      replaceProductImages: async (productId: string, fileIds: string[]) => ({
        ...product,
        id: productId,
        thumbnail_file_id: fileIds[0] ?? null,
        description: null,
        category_ids: [],
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
