/**
 * 业务模块的测试替身（mock services）——交易侧：顾客 / 文件 / 认证 / 库存 /
 * 购物车 / 订单 / 履约 / 主题。
 */
import { DomainError, errors } from "@mall/core";
import { checkPasswordStrength } from "@mall/auth";
import type { FakeServicesState } from "./fake-services-state.js";

export function makeFakeCommerceServices(state: FakeServicesState) {
    const fakeCartState: { country: string | null } = { country: null };
    const fakeCartView = () => ({
      id: "cart_1",
      channel_id: "chn_cn",
      region_id: "reg_1",
      currency_code: "CNY",
      customer_id: null,
      email: "a@b.com",
      status: "open",
      shipping_country: fakeCartState.country,
      voucher_codes: [],
      gift_card_codes: [],
      items: [
        {
          id: "cli_1",
          cart_id: "cart_1",
          variant_id: "var_1",
          product_id: "prod_1",
          title: "T恤",
          quantity: 1,
          unit_price_minor: 9900n,
          currency_code: "CNY",
          discount_minor: 0n,
          tax_rate_bps: 0,
          tax_amount_minor: 0n,
        },
      ],
      // 有国家 = 有可用运费方案（替身简化）；ZZ 表示「该地区不配送」
      shipping_method:
        fakeCartState.country && fakeCartState.country !== "ZZ"
        ? {
            id: "auto_so_1",
            cart_id: "cart_1",
            shipping_option_id: "so_1",
            name: "标准快递",
            amount_minor: 800n,
            currency_code: "CNY",
          }
        : null,
      totals: {
        subtotal_minor: 9900n,
        shipping_minor: fakeCartState.country && fakeCartState.country !== "ZZ" ? 800n : 0n,
        tax_minor: 0n,
        shipping_tax_minor: 0n,
        total_minor:
          fakeCartState.country && fakeCartState.country !== "ZZ" ? 10700n : 9900n,
        discount_minor: 0n,
      },
      discounts: [],
      tax_included_in_price: true,
    });

  // —— 促销/优惠券内存替身（阶段 4 后台管理路由用）——
  const vouchers = new Map<string, Record<string, unknown>>();
  const voucherCodes = new Map<string, Record<string, unknown>>();
  let vCounter = 0;
  let vcCounter = 0;
  // —— 礼品卡内存替身（阶段 5 后台管理路由用）——
  const giftCards = new Map<string, Record<string, unknown>>();
  const giftCardEvents = new Map<string, Record<string, unknown>[]>();
  let gcCounter = 0;
  let gceCounter = 0;
  // —— 目录/订单促销内存替身（二期补齐 promotion admin 管理路由用）——
  const promotions = new Map<string, Record<string, unknown>>();
  const promotionRules = new Map<string, Record<string, unknown>>();
  let pCounter = 0;
  let prCounter = 0;
  // —— 多仓（ADR-013 阶段 2）：仓库 / 调拨流水内存替身 ——
  const stockLocations: Array<{ id: string; name: string; priority: number }> = [
    { id: "loc_1", name: "默认仓", priority: 10 },
    { id: "loc_2", name: "B 仓", priority: 0 },
  ];
  const transfers = new Map<string, Record<string, unknown>>();
  let transferCounter = 0;
  const featureFlags: Record<string, boolean> = {
    promotion: false,
    voucher: false,
    gift_card: false,
  };
  // —— 领券（ADR-029）：内存版，够驱动路由层契约测试 ——
  const collections = new Map<string, { voucherId: string; customerId: string; code: string }>();
  const promotion = {
    getFeatureFlags: async () => ({ ...featureFlags }),
    listPublicVouchers: async (customerId?: string | null) => {
      if (!featureFlags.voucher) return []; // 与真实服务一致：开关关着不露券
      const mine = [...collections.values()].filter((c) => c.customerId === customerId);
      return [...vouchers.values()]
        .filter((v) => v.is_public === true && v.status === "active")
        .map((v) => {
          const count = mine.filter((c) => c.voucherId === v.id).length;
          return { ...v, collected: count > 0, collected_count: count };
        });
    },
    collectVoucher: async (voucherId: string, customerId: string) => {
      const v = vouchers.get(voucherId);
      if (!v) throw errors.notFound("voucher not found");
      if (!featureFlags.voucher || v.is_public !== true) {
        throw errors.validation("该券当前不可领取");
      }
      const key = `${voucherId}:${customerId}`;
      const existing = collections.get(key);
      if (existing) return { code: existing.code, alreadyCollected: true };
      const code = `MOCKCODE${collections.size + 1}`;
      collections.set(key, { voucherId, customerId, code });
      return { code, alreadyCollected: false };
    },
    listCollectedVouchers: async (customerId: string) =>
      [...collections.values()]
        .filter((c) => c.customerId === customerId)
        .map((c) => {
          const v = vouchers.get(c.voucherId)!;
          return {
            id: `vcol_${c.code}`,
            voucher_id: c.voucherId,
            code: c.code,
            name: v.name,
            type: v.type,
            discount_type: v.discount_type,
            discount_value: v.discount_value,
            min_spent: v.min_spent,
            starts_at: v.starts_at,
            ends_at: v.ends_at,
            status: "unused",
            collected_at: new Date(),
            used_at: null,
          };
        }),
    setFeatureEnabled: async (feature: string, enabled: boolean) => {
      featureFlags[feature] = enabled;
    },
    listVouchers: async ({ limit, offset, q }: { limit: number; offset: number; q?: string }) => {
      // 与真实 repo 同口径：q 按名称模糊（大小写不敏感）
      const all = [...vouchers.values()].filter(
        (v) => !q || String(v.name).toLowerCase().includes(q.toLowerCase()),
      );
      const items = all.slice(offset, offset + limit);
      return { items, count: all.length };
    },
    createVoucher: async (input: Record<string, unknown>) => {
      const id = `vouch_${++vCounter}`;
      const v = {
        id,
        name: input.name,
        type: input.type ?? "entire_order",
        usage_limit: input.usageLimit ?? null,
        starts_at: input.startsAt ?? null,
        ends_at: input.endsAt ?? null,
        discount_type: input.discountType,
        discount_value: input.discountValue,
        min_spent: input.minSpent ?? null,
        status: "active",
        is_public: input.isPublic === true,
        collect_limit: input.collectLimit ?? 1,
      };
      vouchers.set(id, v);
      return v;
    },
    retrieveVoucher: async (id: string) => {
      const v = vouchers.get(id);
      if (!v) throw errors.notFound("voucher not found");
      return v;
    },
    updateVoucher: async (id: string, patch: Record<string, unknown>) => {
      const cur = vouchers.get(id);
      if (!cur) throw errors.notFound("voucher not found");
      const next: Record<string, unknown> = { ...cur };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.type !== undefined) next.type = patch.type;
      if (patch.usageLimit !== undefined) next.usage_limit = patch.usageLimit;
      if (patch.startsAt !== undefined) next.starts_at = patch.startsAt;
      if (patch.endsAt !== undefined) next.ends_at = patch.endsAt;
      if (patch.discountType !== undefined) next.discount_type = patch.discountType;
      if (patch.discountValue !== undefined) next.discount_value = patch.discountValue;
      if (patch.minSpent !== undefined) next.min_spent = patch.minSpent;
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.isPublic !== undefined) next.is_public = patch.isPublic;
      if (patch.collectLimit !== undefined) next.collect_limit = patch.collectLimit;
      vouchers.set(id, next);
      return next;
    },
    retrieveVoucherCodeByCode: async (code: string) => {
      for (const c of voucherCodes.values()) if (c.code === code) return c;
      return null;
    },
    addVoucherCode: async ({ voucherId, code }: { voucherId: string; code: string }) => {
      const id = `vcode_${++vcCounter}`;
      const c = { id, voucher_id: voucherId, code, used: 0, is_active: true };
      voucherCodes.set(id, c);
      return c;
    },
    listVoucherCodes: async (voucherId: string) => {
      return [...voucherCodes.values()].filter((c) => c.voucher_id === voucherId);
    },
    deleteVoucherCode: async () => {},
    updateVoucherCode: async (id: string, patch: { isActive?: boolean }) => {
      const cur = voucherCodes.get(id);
      if (!cur) throw errors.notFound("voucher code not found");
      const next = { ...cur, is_active: patch.isActive ?? cur.is_active };
      voucherCodes.set(id, next);
      return next;
    },
    consumeVoucherCodes: async () => {},
    releaseVoucherCodes: async () => {},
    // —— gift card（阶段 5）——
    listGiftCards: async ({ limit, offset, q }: { limit: number; offset: number; q?: string }) => {
      // q 按卡号模糊
      const all = [...giftCards.values()].filter(
        (g) => !q || String(g.code).toLowerCase().includes(q.toLowerCase()),
      );
      const items = all.slice(offset, offset + limit);
      return { items, count: all.length };
    },
    createGiftCard: async (input: Record<string, unknown>) => {
      const id = `gcard_${++gcCounter}`;
      const card = {
        id,
        code: input.code,
        currency: input.currency,
        initial_balance: Number(input.initialBalance),
        current_balance: Number(input.initialBalance),
        is_active: true,
        expires_at: input.expiresAt ?? null,
        assigned_to: input.assignedTo ?? null,
      };
      giftCards.set(id, card);
      const events = giftCardEvents.get(id) ?? [];
      events.push({
        id: `gcevt_${++gceCounter}`,
        gift_card_id: id,
        type: "issued",
        amount: Number(input.initialBalance),
        order_id: null,
        parameters: { currency: input.currency },
        created_at: new Date().toISOString(),
      });
      giftCardEvents.set(id, events);
      return card;
    },
    retrieveGiftCard: async (id: string) => {
      const g = giftCards.get(id);
      if (!g) throw errors.notFound("gift card not found");
      return g;
    },
    retrieveGiftCardByCode: async (code: string) => {
      for (const g of giftCards.values()) if (g.code === code) return g;
      return null;
    },
    updateGiftCard: async (id: string, patch: Record<string, unknown>) => {
      const cur = giftCards.get(id);
      if (!cur) throw errors.notFound("gift card not found");
      const next: Record<string, unknown> = { ...cur };
      if (patch.expiresAt !== undefined) next.expires_at = patch.expiresAt;
      if (patch.assignedTo !== undefined) next.assigned_to = patch.assignedTo;
      giftCards.set(id, next);
      return next;
    },
    setGiftCardActive: async (id: string, isActive: boolean) => {
      const cur = giftCards.get(id);
      if (!cur) throw errors.notFound("gift card not found");
      const next: Record<string, unknown> = { ...cur, is_active: isActive };
      giftCards.set(id, next);
      const events = giftCardEvents.get(id) ?? [];
      events.push({
        id: `gcevt_${++gceCounter}`,
        gift_card_id: id,
        type: isActive ? "activated" : "deactivated",
        amount: 0,
        order_id: null,
        parameters: null,
        created_at: new Date().toISOString(),
      });
      giftCardEvents.set(id, events);
      return next;
    },
    adjustGiftCardBalance: async (id: string, deltaMinor: bigint, parameters?: Record<string, unknown> | null) => {
      const cur = giftCards.get(id);
      if (!cur) throw errors.notFound("gift card not found");
      const delta = Number(deltaMinor);
      const next: Record<string, unknown> = { ...cur, current_balance: Number(cur.current_balance) + delta };
      giftCards.set(id, next);
      const events = giftCardEvents.get(id) ?? [];
      events.push({
        id: `gcevt_${++gceCounter}`,
        gift_card_id: id,
        type: "balance_adjusted",
        amount: delta,
        order_id: null,
        parameters: parameters ?? null,
        created_at: new Date().toISOString(),
      });
      giftCardEvents.set(id, events);
      return next;
    },
    listGiftCardEvents: async (id: string) => giftCardEvents.get(id) ?? [],
    consumeGiftCards: async () => {},
    releaseGiftCards: async () => {},
    // —— 目录/订单促销（promotion 表，二期补齐 admin 路由用）——
    listPromotions: async ({
      limit,
      offset,
      q,
      type,
      status,
    }: {
      limit: number;
      offset: number;
      q?: string;
      type?: string;
      status?: string;
    }) => {
      // 与真实 repo 同口径：筛选在查询里完成，不是取回后过滤
      const all = [...promotions.values()].filter(
        (p) =>
          (!type || p.type === type) &&
          (!status || p.status === status) &&
          (!q ||
            String(p.name).toLowerCase().includes(q.toLowerCase()) ||
            String(p.code ?? "").toLowerCase().includes(q.toLowerCase())),
      );
      const items = all.slice(offset, offset + limit);
      return { items, count: all.length };
    },
    createPromotion: async (input: Record<string, unknown>) => {
      const id = `promo_${++pCounter}`;
      const p = {
        id,
        name: input.name,
        code: input.code ?? null,
        type: input.type,
        status: input.status ?? "draft",
        is_automatic: input.isAutomatic ?? false,
        starts_at: input.startsAt ?? null,
        ends_at: input.endsAt ?? null,
        usage_limit: input.usageLimit ?? null,
        used: 0,
        metadata: input.metadata ?? null,
      };
      promotions.set(id, p);
      return p;
    },
    retrievePromotion: async (id: string) => {
      const p = promotions.get(id);
      if (!p) throw errors.notFound("promotion not found");
      return p;
    },
    updatePromotion: async (id: string, patch: Record<string, unknown>) => {
      const cur = promotions.get(id);
      if (!cur) throw errors.notFound("promotion not found");
      const next: Record<string, unknown> = { ...cur };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.code !== undefined) next.code = patch.code;
      if (patch.type !== undefined) next.type = patch.type;
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.isAutomatic !== undefined) next.is_automatic = patch.isAutomatic;
      if (patch.startsAt !== undefined) next.starts_at = patch.startsAt;
      if (patch.endsAt !== undefined) next.ends_at = patch.endsAt;
      if (patch.usageLimit !== undefined) next.usage_limit = patch.usageLimit;
      if (patch.metadata !== undefined) next.metadata = patch.metadata;
      promotions.set(id, next);
      return next;
    },
    deletePromotion: async (id: string) => {
      if (!promotions.has(id)) throw errors.notFound("promotion not found");
      promotions.delete(id);
    },
    addPromotionRule: async (input: Record<string, unknown>) => {
      const id = `prorul_${++prCounter}`;
      const r = {
        id,
        promotion_id: input.promotionId,
        predicate: input.predicate ?? {},
        reward_type: input.rewardType,
        reward_value: Number(input.rewardValue),
        allocation: input.allocation ?? null,
      };
      promotionRules.set(id, r);
      return r;
    },
    listPromotionRules: async (promotionId: string) => {
      return [...promotionRules.values()].filter((r) => r.promotion_id === promotionId);
    },
    deletePromotionRule: async (id: string) => {
      if (!promotionRules.has(id)) throw errors.notFound("promotion rule not found");
      promotionRules.delete(id);
    },
  };

  const orderItem = {
    id: "oli_1",
    order_id: "ord_1",
    variant_id: "var_1",
    product_id: "prod_1",
    title: "T恤",
    sku: "TEE-S",
    quantity: 1,
    unit_price_minor: 9900n,
    tax_rate_bps: 0,
    tax_amount_minor: 0n,
    total_minor: 9900n,
    currency_code: "CNY",
    options: null,
  };
  const order = {
    id: "ord_1",
    status: "pending",
    payment_status: "unpaid",
    email: "a@b.com",
    currency_code: "CNY",
    channel_id: "chn_cn",
    region_id: "reg_1",
    subtotal_minor: 9900n,
    shipping_minor: 800n,
    tax_minor: 0n,
    discount_minor: 0n,
    total_minor: 10700n,
    shipping_address: {},
    payment_collection_id: null,
    placed_at: new Date().toISOString(),
    // 两种备注可见范围相反（ADR-050）：顾客留言进门店契约，商家备注只进后台
    merchant_note: null,
    customer_note: null,
    items: [orderItem],
    // 订单记下了所选运费方式：详情页要显示它（ADR-034）
    shipping_method: {
      id: "osm_1",
      order_id: "ord_1",
      name: "标准快递",
      carrier_name: "顺丰",
      amount_minor: 800n,
      currency_code: "CNY",
    },
  };

  /** 收藏记录（ADR-048）：内存版，够驱动收藏路由的契约测试。 */
  const favorites: Array<{ customerId: string; productId: string; createdAt: Date }> = [];

  return {
    promotion,
    customer: {
      retrieveCustomer: async (id: string) => {
        if (id !== "cust_1") {
          throw new DomainError({ code: 30001, message: `客户不存在：${id}` });
        }
        return {
          id: "cust_1",
          email: "a@b.com",
          first_name: null,
          last_name: null,
          phone: null,
          metadata: null,
        };
      },
      listAddresses: async (customerId: string) =>
        customerId === "cust_1"
          ? [
              {
                id: "addr_1",
                customer_id: "cust_1",
                first_name: "三",
                last_name: "张",
                phone: "13800000000",
                line1: "示例路 1 号",
                line2: null,
                city: "杭州",
                province: "浙江",
                postal_code: "310000",
                country_code: "CN",
                is_default_shipping: true,
                is_default_billing: false,
              },
            ]
          : [],
      addAddress: async (customerId: string, input: Record<string, unknown>) => ({
        id: "addr_new",
        customer_id: customerId,
        first_name: String(input.firstName ?? ""),
        last_name: String(input.lastName ?? ""),
        phone: (input.phone as string | null) ?? null,
        line1: String(input.line1 ?? ""),
        line2: (input.line2 as string | null) ?? null,
        city: String(input.city ?? ""),
        province: (input.province as string | null) ?? null,
        postal_code: String(input.postalCode ?? ""),
        country_code: String(input.countryCode ?? "CN"),
        is_default_shipping: input.isDefaultShipping === true,
        is_default_billing: input.isDefaultBilling === true,
      }),
      updateAddress: async (customerId: string, addressId: string, input: Record<string, unknown>) => ({
        id: addressId,
        customer_id: customerId,
        first_name: String(input.firstName ?? "三"),
        last_name: String(input.lastName ?? "张"),
        phone: (input.phone as string | null) ?? null,
        line1: String(input.line1 ?? "示例路 1 号"),
        line2: null,
        city: String(input.city ?? "杭州"),
        province: null,
        postal_code: "310000",
        country_code: "CN",
        is_default_shipping: false,
        is_default_billing: false,
      }),
      deleteAddress: async () => {},
      // —— 收藏（ADR-048）——
      addFavorite: async (customerId: string, productId: string) => {
        if (!favorites.some((f) => f.customerId === customerId && f.productId === productId)) {
          favorites.push({ customerId, productId, createdAt: new Date() });
        }
      },
      removeFavorite: async (customerId: string, productId: string) => {
        const idx = favorites.findIndex(
          (f) => f.customerId === customerId && f.productId === productId,
        );
        if (idx >= 0) favorites.splice(idx, 1);
      },
      listFavorites: async (customerId: string, q: { limit: number; offset: number }) => {
        const mine = favorites.filter((f) => f.customerId === customerId);
        return {
          items: mine
            .slice(q.offset, q.offset + q.limit)
            .map((f) => ({ product_id: f.productId, created_at: f.createdAt })),
          count: mine.length,
        };
      },
      listFavoriteProductIds: async (customerId: string) =>
        favorites.filter((f) => f.customerId === customerId).map((f) => f.productId),
      setDefaultAddress: async (customerId: string, addressId: string) => ({
        id: addressId,
        customer_id: customerId,
        first_name: "三",
        last_name: null,
        phone: "13800000000",
        line1: "示例路 1 号",
        line2: null,
        city: null,
        province: "浙江省杭州市西湖区",
        postal_code: null,
        country_code: "CN",
        is_default_shipping: true,
        is_default_billing: false,
      }),
      listCustomers: async () => ({
        items: [
          {
            id: "cust_1",
            email: "a@b.com",
            first_name: null,
            last_name: null,
            phone: null,
            metadata: null,
          },
        ],
        count: 1,
      }),
    },
    file: {
      upload: async () => ({
        id: "file_1",
        key: "k",
        filename: "f",
        content_type: "image/png",
        size_bytes: 1,
        width_px: null,
        height_px: null,
        storage_provider: "local",
      }),
      getPublicUrl: async () => "/uploads/k",
      getPublicUrls: async (ids: string[]) =>
        Object.fromEntries(ids.map((id) => [id, `/uploads/${id}`])),
      deleteFile: async () => {},
    },
    auth: {
      verifyAccessToken: async (token: string) => {
        if (token === "admin") {
          return {
            sub: "adm_1",
            scope: "admin",
            customerId: null,
            roles: ["admin"],
            permissions: "all",
          };
        }
        // 顾客 token：sub 是 identity id，customerId 才是订单归属（两者不能混用）
        if (token === "customer") {
          return {
            sub: "ident_cust_1",
            scope: "customer",
            customerId: "cust_1",
            roles: [],
            permissions: [],
          };
        }
        if (token === "staff") {
          return {
            sub: "adm_2",
            scope: "admin",
            customerId: null,
            roles: ["staff"],
            // 与真实 seedRoles 对齐：staff 持有 products/orders/customers/inventory/files，无 settings。
            permissions: ["products", "orders", "customers", "inventory", "files"],
          };
        }
        throw errors.invalidCredentials("token 无效");
      },
      assertPermission: (ctx: { scope: string; permissions: string[] | "all" }, perm: string) => {
        if (ctx.scope !== "admin") throw errors.forbidden(perm);
        if (ctx.permissions === "all") return;
        if (Array.isArray(ctx.permissions) && ctx.permissions.includes(perm)) return;
        throw errors.forbidden(perm);
      },
      adminLogin: async (input: { email: string; password: string }) => {
        if (input.password !== state.adminPassword) throw errors.invalidCredentials();
        return {
          accessToken: "admin",
          refreshToken: "r",
          accessExpiresIn: 900,
          identityId: "adm_1",
          scope: "admin",
        };
      },
      changeCustomerPassword: async (input: {
        identityId: string;
        currentPassword: string;
        newPassword: string;
      }) => {
        // 与真实服务同语义：先验当前口令、再强度、再查重，最后撤销全部会话
        if (input.currentPassword !== state.customerPassword) throw errors.invalidCredentials();
        const strength = checkPasswordStrength(input.newPassword);
        if (!strength.ok) throw errors.validation(strength.reason ?? "新口令强度不足");
        if (input.newPassword === state.customerPassword) {
          throw errors.validation("新口令不能与当前口令相同");
        }
        state.customerPassword = input.newPassword;
        state.revokedRefreshTokens += 1;
        return { revokedRefreshTokens: state.revokedRefreshTokens };
      },
      changeAdminPassword: async (input: {
        identityId: string;
        currentPassword: string;
        newPassword: string;
      }) => {
        if (input.currentPassword !== state.adminPassword) throw errors.invalidCredentials();
        const strength = checkPasswordStrength(input.newPassword);
        if (!strength.ok) throw errors.validation(strength.reason ?? "新口令强度不足");
        if (input.newPassword === state.adminPassword) {
          throw errors.validation("新口令不能与当前口令相同");
        }
        state.adminPassword = input.newPassword;
        state.revokedRefreshTokens += 1;
        return { revokedRefreshTokens: state.revokedRefreshTokens };
      },
      login: async () => ({
        accessToken: "cust",
        refreshToken: "r",
        accessExpiresIn: 900,
        identityId: "aid",
        scope: "customer",
      }),
      refresh: async () => ({
        accessToken: "cust",
        refreshToken: "r2",
        accessExpiresIn: 900,
        identityId: "aid",
        scope: "customer",
      }),
      logout: async () => {},
      register: async () => ({ identityId: "aid", customerId: "cust_1" }),
      /** 顾客账号设置：默认邮箱注册，测试里可改 state 后验证开关。 */
      getSettings: async () => ({ register_mode: state.registerMode }),
      updateSettings: async (patch: { register_mode?: "email" | "phone" }) => {
        if (patch.register_mode) state.registerMode = patch.register_mode;
        return { register_mode: state.registerMode };
      },
      sendVerificationCode: async () => ({ sent: true, devCode: "123456" }),
      requestPasswordReset: async (input: { identifier: string }) => {
        const known = input.identifier === "a@b.com" || input.identifier === "13800001111";
        if (!known) {
          throw new DomainError({ code: 30001, message: `该账号未注册：${input.identifier}，请先注册` });
        }
        return {
          sent: true,
          channel: input.identifier.includes("@") ? ("email" as const) : ("sms" as const),
          devCode: "123456",
        };
      },
      resetPassword: async (input: { identifier: string; code: string; newPassword: string }) => {
        if (input.identifier !== "a@b.com" && input.identifier !== "13800001111") {
          throw new DomainError({ code: 30001, message: `该账号未注册：${input.identifier}` });
        }
        if (input.code !== "123456") {
          throw new DomainError({ code: 20001, message: "验证码不正确或已失效" });
        }
        return { revokedRefreshTokens: 1 };
      },
      loginWithPhoneCode: async () => ({
        accessToken: "cust",
        refreshToken: "r",
        accessExpiresIn: 900,
        identityId: "aid",
        scope: "customer",
      }),
      seedRoles: async () => {},
    },
    inventory: {
      getAvailability: async ({ variantIds }: { variantIds: string[] }) =>
        variantIds.map((id) => ({ variantId: id, available: state.variantAvailable ?? 12 })),
      // 仓由后端决定：路由不再取仓，整单一次分配（ADR-013）
      allocateAndReserve: async (input: {
        orderId: string;
        items: Array<{ variantId: string; quantity: number }>;
      }) => ({
        reservationIds: input.items.map((_, i) => `rsv_${i + 1}`),
        allocations: input.items.map((item) => ({
          variantId: item.variantId,
          stockLocationId: "loc_1",
          quantity: item.quantity,
        })),
      }),
      releaseReservation: async () => {},
      listInventoryItems: async () => ({
        items: [{ id: "invitem_1", sku: "SKU-1", title: "T恤", requires_shipping: true }],
        count: 1,
      }),
      adjustLevelByLevelId: async (_id: string, input: { delta: number }) => ({
        id: "invlvl_1",
        inventory_item_id: "invitem_1",
        stock_location_id: "loc_1",
        stocked_quantity: 10 + input.delta,
        reserved_quantity: 0,
        available_quantity: 10 + input.delta,
      }),
      // —— 多仓（ADR-013 阶段 2）：仓库 / 按仓库存行 / 预留明细 / 调拨 ——
      listStockLocations: async () => stockLocations.map((l) => ({ ...l })),
      createStockLocation: async (input: { name: string; priority?: number }) => {
        const loc = {
          id: `loc_${stockLocations.length + 1}`,
          name: input.name,
          priority: input.priority ?? 0,
        };
        stockLocations.push(loc);
        return loc;
      },
      updateStockLocation: async (id: string, patch: { name?: string; priority?: number }) => {
        const loc = stockLocations.find((l) => l.id === id);
        if (!loc) throw errors.notFound("stock location not found");
        if (patch.name !== undefined) loc.name = patch.name;
        if (patch.priority !== undefined) loc.priority = patch.priority;
        return { ...loc };
      },
      listInventoryLevels: async (q?: { locationId?: string; lowStockThreshold?: number }) => {
        // 一行可用 10 的库存：阈值 ≥10 命中，<10 不命中（够验筛选是否真的生效）
        const available = 10;
        const hit =
          q?.lowStockThreshold === undefined || available <= q.lowStockThreshold;
        const items = hit
          ? [
              {
                id: "invlvl_1",
                inventory_item_id: "invitem_1",
                sku: "SKU-1",
                stock_location_id: q?.locationId ?? "loc_1",
                stocked_quantity: 10,
                reserved_quantity: 0,
                available_quantity: available,
              },
            ]
          : [];
        return { items, count: items.length };
      },
      listReservationIdsByOrder: async () => ["rsv_1"],
      listReservationsByOrder: async (orderId: string) => [
        {
          id: "rsv_1",
          inventory_item_id: "invitem_1",
          variant_id: "var_1",
          stock_location_id: "loc_1",
          line_item_id: `${orderId}:var_1:loc_1`,
          order_id: orderId,
          quantity: 1,
          status: "reserved",
          workflow_run_id: null,
        },
      ],
      createInventoryTransfer: async (input: Record<string, unknown>) => {
        const t = {
          id: `xfer_${++transferCounter}`,
          inventory_item_id: input.inventoryItemId,
          from_location_id: input.fromLocationId,
          to_location_id: input.toLocationId,
          quantity: input.quantity,
          status: "pending",
          note: input.note ?? null,
          created_by: input.createdBy ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        transfers.set(t.id, t);
        return t;
      },
      completeInventoryTransfer: async (id: string) => {
        const t = transfers.get(id);
        if (!t) throw errors.notFound("transfer not found");
        t.status = "completed";
        return t;
      },
      cancelInventoryTransfer: async (id: string) => {
        const t = transfers.get(id);
        if (!t) throw errors.notFound("transfer not found");
        t.status = "cancelled";
        return t;
      },
      listInventoryTransfers: async ({ limit, offset }: { limit: number; offset: number }) => {
        const items = [...transfers.values()].slice(offset, offset + limit);
        return { items, count: transfers.size };
      },
    },
    // 购物车替身：收货国家决定「有没有运费 / 能不能下单」（ADR-019）
    cart: {
      retrieveCart: async () => fakeCartView(),
      setShippingCountry: async (_id: string, code: string) => {
        fakeCartState.country = code.trim().toUpperCase();
        return fakeCartView();
      },
      // 运费由服务端自动选：这个接口不再改变金额，只返回当前视图
      setShippingMethod: async () => fakeCartView(),
      createCart: async () => ({ id: "cart_1" }),
      setVoucherCodes: async (_id: string, codes: string[]) => ({
        id: "cart_1",
        channel_id: "chn_cn",
        region_id: "reg_1",
        currency_code: "CNY",
        customer_id: null,
        email: "a@b.com",
        status: "open",
        voucher_codes: codes,
        gift_card_codes: [],
        items: [
          {
            id: "cli_1",
            cart_id: "cart_1",
            variant_id: "var_1",
            product_id: "prod_1",
            title: "T恤",
            quantity: 1,
            unit_price_minor: 9900n,
            currency_code: "CNY",
            discount_minor: 0n,
          },
        ],
        shipping_method: null,
        totals: {
          subtotal_minor: 9900n,
          shipping_minor: 0n,
          tax_minor: 0n,
          total_minor: 9900n,
          discount_minor: 0n,
        },
        discounts: [],
      }),
      setGiftCardCodes: async (_id: string, codes: string[]) => ({
        id: "cart_1",
        channel_id: "chn_cn",
        region_id: "reg_1",
        currency_code: "CNY",
        customer_id: null,
        email: "a@b.com",
        status: "open",
        voucher_codes: [],
        gift_card_codes: codes,
        items: [
          {
            id: "cli_1",
            cart_id: "cart_1",
            variant_id: "var_1",
            product_id: "prod_1",
            title: "T恤",
            quantity: 1,
            unit_price_minor: 9900n,
            currency_code: "CNY",
            discount_minor: 0n,
          },
        ],
        shipping_method: null,
        totals: {
          subtotal_minor: 9900n,
          shipping_minor: 0n,
          tax_minor: 0n,
          total_minor: 9900n,
          discount_minor: 0n,
        },
        discounts: [],
      }),
      // checkout 下单成功后会作废购物车（一车一单）。测试里幂等重放/下单路径不依赖它的副作用，
      // 只要求接口存在、不抛错。
      completeCart: async () => {},
    },
    order: (() => {
      let refundSeq = 0;
      const refundRequests: Array<{
        id: string;
        order_id: string;
        customer_id: string | null;
        amount_minor: bigint;
        currency_code: string;
        reason: string;
        source: "customer" | "merchant";
        status: "pending" | "awaiting_return" | "returned" | "approved" | "rejected" | "canceled";
        resolution: "refund_only" | "return_refund";
        return_carrier: string | null;
        return_tracking_number: string | null;
        return_shipped_at: string | null;
        return_received_at: string | null;
        review_note: string | null;
        reviewed_at: string | null;
        refund_id: string | null;
        order_status_before: string | null;
        created_at: string;
        order_email: string | null;
      }> = [];
      return {
      retrieveOrder: async (id?: string) => {
        // ord_other 属于别的顾客：用来验「知道单号也看不到别人的订单」
        const base = id === "ord_other" ? { ...order, id: "ord_other", customer_id: "cust_2" } : { ...order };
        // state.orderStatus 让测试把订单摆到指定状态（确认收货只对 fulfilled/delivered 开放）
        return {
          ...base,
          status: state.orderStatus ?? base.status,
          // 顾客留言：默认 null，测试可置值验「店面与后台看到同一段」
          customer_note: state.orderCustomerNote ?? base.customer_note,
        };
      },
      transition: async (_id: string, to: string) => {
        // 与真实状态机同语义：改状态并留痕（此处只改内存，够驱动路由契约）
        order.status = to;
        state.orderStatus = to;
        return { ...order, status: to };
      },
      /*
       * 我的订单：只按传入的 customerId 过滤（路由从 token 取，不接受 query 覆盖）。
       * 行项直接复用 retrieveOrder 的 items，够验「列表能显示商品」。
       */
      /** 客户维度汇总：只算已付款未退款（与真实 SQL 口径一致）。 */
      summarizeByCustomerIds: async (customerIds: string[]) => {
        if (!customerIds.includes("cust_1")) return [];
        return [
          {
            customer_id: "cust_1",
            order_count: 2,
            total_spent_minor: 21400n,
            last_order_at: "2026-11-01T10:00:00.000Z",
          },
        ];
      },
      listOrderSummaries: async (q: {
        customerId?: string;
        statuses?: string[];
        q?: string;
        createdFrom?: Date;
        createdTo?: Date;
        limit?: number;
        offset?: number;
      }) => {
        // 店面：只返回该顾客的订单
        if (q.customerId) {
          if (q.customerId !== "cust_1") return { items: [], count: 0 };
        } else if (state.ordersTotalOverride !== undefined) {
          // 只用于「导出超上限被拒」这类用例：行数不重要，总数才重要
          return {
            items: [{ ...order, customer_note: state.orderCustomerNote ?? order.customer_note, items: [{ ...order.items[0] }] }],
            count: state.ordersTotalOverride,
          };
        } else if (!state.orderCreated) {
          // 后台：没下过单就是空列表
          return { items: [], count: 0 };
        }
        // 后台页签与搜索：按状态集合 / 订单号邮箱过滤
        if (q.statuses && q.statuses.length > 0 && !q.statuses.includes(order.status)) {
          return { items: [], count: 0 };
        }
        if (q.q) {
          const needle = q.q.toLowerCase();
          const hay = `${order.id} ${order.email}`.toLowerCase();
          if (!hay.includes(needle)) return { items: [], count: 0 };
        }
        // 日期范围（ADR-056）：假订单的下单时间就是 placed_at
        const placedAt = new Date(String(order.placed_at));
        if (q.createdFrom && placedAt < q.createdFrom) return { items: [], count: 0 };
        if (q.createdTo && placedAt > q.createdTo) return { items: [], count: 0 };
        const item = {
          ...order,
          customer_id: "cust_1",
          // 与 retrieveOrder 同一口径：测试可覆盖顾客留言（导出要验转义/注入）
          customer_note: state.orderCustomerNote ?? order.customer_note,
          items: [{ ...order.items[0] }],
        };
        return { items: [item], count: 1 };
      },
      setMerchantNote: async (_id: string, note: string | null) => {
        // 与真实服务同语义：trim 后为空即清空（null），不是存一串空格
        const trimmed = note?.trim() ?? "";
        order.merchant_note = trimmed === "" ? null : trimmed;
        return order;
      },
      /*
       * 真实 listOrders 按 cartId 过滤：cart_1 尚未下单时返回空，
       * 下单成功后（workflow 里 createOrder 返回 ord_1）才有记录。
       * 这里用 state 里的一个布尔位模拟「是否已下单」，保证幂等重放测试能验证「已下单 → 返回 200」。
       */
      listOrders: async (q?: { cartId?: string }) =>
        state.orderCreated && (!q?.cartId || q.cartId === "cart_1")
          ? { items: [order], count: 1 }
          : { items: [], count: 0 },
      // 工作台（ADR-030）：内存版计数，够驱动路由契约测试
      countByStatus: async () => (state.orderCreated ? { paid: 1 } : {}),
      summarizePaidSince: async () => ({
        count: state.orderCreated ? 1 : 0,
        amountMinor: state.orderCreated ? BigInt(String(order.total_minor ?? 0)) : 0n,
        currencyCode: "CNY",
      }),
      cancelOrder: async () => {},
      /*
       * 退款申请单用内存数组：够跑「申请 → 列表 → 同意/拒绝」这条链。
       * 真实守卫（订单可退、金额全额、重复申请）在模块单测里守，这里只保证接口形状对。
       */
      createRefundRequest: async (
        orderId: string,
        input: {
          amountMinor: bigint;
          reason: string;
          source?: string;
          customerId?: string | null;
          resolution?: "refund_only" | "return_refund";
        },
      ) => {
        const req = {
          id: `rfr_${++refundSeq}`,
          order_id: orderId,
          customer_id: input.customerId ?? null,
          amount_minor: input.amountMinor,
          currency_code: "CNY",
          reason: input.reason,
          source: (input.source ?? "customer") as "customer" | "merchant",
          status: "pending" as const,
          resolution: (input.resolution ?? "refund_only") as "refund_only" | "return_refund",
          return_carrier: null,
          return_tracking_number: null,
          return_shipped_at: null,
          return_received_at: null,
          review_note: null,
          reviewed_at: null,
          refund_id: null,
          order_status_before: order.status,
          created_at: new Date().toISOString(),
          order_email: "a@b.com",
        };
        refundRequests.push(req);
        // 申请即冻结（与真实服务同语义）：退款中不能发货
        order.status = "refund_pending";
        return req;
      },
      listRefundRequests: async (q: {
        status?: string;
        orderId?: string;
        limit?: number;
        offset?: number;
      }) => {
        let all = q.status ? refundRequests.filter((r) => r.status === q.status) : refundRequests;
        if (q.orderId) all = all.filter((r) => r.order_id === q.orderId);
        const offset = q.offset ?? 0;
        const limit = q.limit ?? all.length;
        const counts: Record<string, number> = {};
        for (const r of refundRequests) counts[r.status] = (counts[r.status] ?? 0) + 1;
        return { items: all.slice(offset, offset + limit), count: all.length, counts };
      },
      countRefundRequestsByStatus: async () => {
        const counts: Record<string, number> = {};
        for (const r of refundRequests) counts[r.status] = (counts[r.status] ?? 0) + 1;
        return counts;
      },
      findRefundRequest: async (id: string) => refundRequests.find((r) => r.id === id) ?? null,
      approveRefundRequest: async (id: string, refundId: string, note?: string | null) => {
        const req = refundRequests.find((r) => r.id === id)!;
        // 与真实服务同守卫：退货退款不能走这条直路（货没回来钱先走）
        if (req.resolution !== "refund_only") {
          throw new Error("售后类型不匹配：退货退款不能直接同意打款");
        }
        req.status = "approved";
        req.refund_id = refundId;
        req.review_note = note ?? null;
        order.status = "refunded";
        return req;
      },
      /* 退货退款：同意只改单据，不动钱；填单号；确认收货才 approved */
      agreeReturnRequest: async (id: string, note?: string | null) => {
        const req = refundRequests.find((r) => r.id === id)!;
        if (req.resolution !== "return_refund") {
          throw new Error("售后类型不匹配：该申请是仅退款");
        }
        req.status = "awaiting_return";
        req.review_note = note ?? null;
        return req;
      },
      shipReturn: async (id: string, input: { carrier: string; trackingNumber: string }) => {
        const req = refundRequests.find((r) => r.id === id)!;
        if (!input.carrier.trim() || !input.trackingNumber.trim()) {
          throw new Error("请填写退货物流公司与单号");
        }
        req.status = "returned";
        req.return_carrier = input.carrier.trim();
        req.return_tracking_number = input.trackingNumber.trim();
        req.return_shipped_at = new Date().toISOString();
        return req;
      },
      confirmReturnReceived: async (id: string, refundId: string, note?: string | null) => {
        const req = refundRequests.find((r) => r.id === id)!;
        req.status = "approved";
        req.refund_id = refundId;
        req.return_received_at = new Date().toISOString();
        if (note) req.review_note = note;
        order.status = "refunded";
        return req;
      },
      rejectRefundRequest: async (id: string, note: string) => {
        const req = refundRequests.find((r) => r.id === id)!;
        req.status = "rejected";
        req.review_note = note;
        order.status = req.order_status_before ?? "paid";
        return req;
      },
      cancelRefundRequest: async (id: string) => {
        const req = refundRequests.find((r) => r.id === id)!;
        req.status = "canceled";
        order.status = req.order_status_before ?? "paid";
        return req;
      },
      markRefundSettled: async () => {
        order.status = "refunded";
        return order;
      },
      };
    })(),
    /*
     * 履约替身：运费配置用内存数组，够跑「建区 → 建方式 → 结账可下单国家」这条链。
     * 守卫逻辑不在替身里复刻（那会变成第二套实现），真实规则由模块单测守。
     */
    fulfillment: (() => {
      const profiles: Array<{ id: string; name: string; is_default: boolean }> = [
        { id: "shprof_default", name: "默认运费模板", is_default: true },
      ];
      const zones: Array<{
        id: string;
        name: string;
        profile_id: string | null;
        country_codes: string[];
      }> = [
        {
          id: "zone_default",
          name: "默认区",
          profile_id: "shprof_default",
          country_codes: [
            "CN",
            "HK",
            "MO",
            "JP",
            "KR",
            "SG",
            "MY",
            "TH",
            "VN",
            "US",
            "GB",
            "DE",
            "FR",
            "AU",
            "CA",
          ],
        },
      ];
      const options: Array<{
        id: string;
        zone_id: string;
        name: string;
        carrier: string | null;
        type: "flat" | "free_over" | "weight_based";
        amount_minor: bigint;
        currency_code: string;
        is_active: boolean;
        free_over_threshold_minor: bigint | null;
      }> = [
        {
          id: "shipopt_default",
          zone_id: "zone_default",
          name: "标准快递",
          carrier: null,
          type: "flat",
          amount_minor: 800n,
          currency_code: "CNY",
          is_active: true,
          free_over_threshold_minor: null,
        },
      ];
      let seq = 0;
      return {
        listShippingOptions: async (input: { countryCode: string }) =>
          options.filter((o) => {
            const zone = zones.find((z) => z.id === o.zone_id);
            return o.is_active && (zone?.country_codes ?? []).includes(input.countryCode);
          }),
        findShippingOption: async (id: string) => options.find((o) => o.id === id) ?? null,
        createFulfillment: async (input: { stockLocationId?: string }) => ({
          id: "fulf_1",
          order_id: "ord_1",
          stock_location_id: input.stockLocationId ?? "loc_1",
          status: "fulfilled",
          reservation_ids: ["rsv_1"],
          items: [],
          tracking_links: null,
        }),
        // 导出用：一次取回多单的第一条运单（真实实现是一条 join）
        listFirstTrackingByOrderIds: async (orderIds: string[]) =>
          orderIds.map((id) => ({ orderId: id, carrier: "顺丰", number: "SF1" })),
        listByOrder: async () => [
          {
            id: "fulf_1",
            order_id: "ord_1",
            stock_location_id: "loc_1",
            status: "shipped",
            reservation_ids: ["rsv_1"],
            items: [],
            tracking_links: [{ carrier: "顺丰", number: "SF1" }],
          },
        ],
        findFulfillment: async (id: string) => ({
          id,
          order_id: "ord_1",
          stock_location_id: "loc_1",
          status: "fulfilled" as const,
          reservation_ids: [],
          tracking_links: null,
        }),
        addShipment: async () => ({
          id: "ship_1",
          fulfillment_id: "fulf_1",
          carrier_name: "顺丰",
          tracking_number: "SF1",
          shipped_at: new Date().toISOString(),
        }),
        calculateShippingPrice: async () => ({ amountMinor: 0n, currencyCode: "CNY" }),
        listDeliverableCountries: async () => [
          ...new Set(
            zones
              .filter((z) => options.some((o) => o.zone_id === z.id && o.is_active))
              .flatMap((z) => z.country_codes),
          ),
        ],
        listShippingProfiles: async () => profiles.map((p) => ({ ...p })),
        getDefaultProfileId: async () => profiles.find((p) => p.is_default)?.id ?? null,
        createShippingProfile: async (input: { name: string }) => {
          const p = { id: `shprof_${++seq}`, name: input.name, is_default: false };
          profiles.push(p);
          return { ...p };
        },
        updateShippingProfile: async (id: string, input: { name?: string }) => {
          const p = profiles.find((x) => x.id === id);
          if (!p) throw new DomainError({ code: 30001, message: `运费模板不存在：${id}` });
          if (input.name !== undefined) p.name = input.name;
          return { ...p };
        },
        deleteShippingProfile: async (id: string) => {
          const p = profiles.find((x) => x.id === id);
          if (!p) throw new DomainError({ code: 30001, message: `运费模板不存在：${id}` });
          if (p.is_default) {
            throw new DomainError({ code: 30002, message: "默认运费模板不能删除" });
          }
          const count = zones.filter((z) => z.profile_id === id).length;
          if (count > 0) {
            throw new DomainError({
              code: 30002,
              message: `运费模板「${p.name}」下还有 ${count} 个发货区，请先删除或改到别的模板`,
            });
          }
          profiles.splice(profiles.indexOf(p), 1);
        },
        listShippingZones: async (profileId?: string | null) =>
          zones
            .filter((z) => (profileId === undefined ? true : z.profile_id === profileId))
            .map((z) => ({ ...z, country_codes: [...z.country_codes] })),
        createShippingZone: async (input: {
          name: string;
          countryCodes: string[];
          profileId?: string | null;
        }) => {
          const taken = new Map<string, string>();
          for (const z of zones) for (const c of z.country_codes) taken.set(c, z.name);
          for (const code of input.countryCodes) {
            const owner = taken.get(code);
            if (owner) {
              throw new DomainError({
                code: 30002,
                message: `国家 ${code} 已在发货区「${owner}」中，请先从该区移除`,
              });
            }
          }
          const zone = {
            id: `zone_${++seq}`,
            name: input.name,
            profile_id: input.profileId ?? profiles.find((p) => p.is_default)?.id ?? null,
            country_codes: [...input.countryCodes],
          };
          zones.push(zone);
          return { ...zone };
        },
        updateShippingZone: async (
          id: string,
          input: { name?: string; countryCodes?: string[] },
        ) => {
          const zone = zones.find((z) => z.id === id);
          if (!zone) throw new DomainError({ code: 30001, message: `Shipping zone not found: ${id}` });
          if (input.name !== undefined) zone.name = input.name;
          if (input.countryCodes !== undefined) zone.country_codes = [...input.countryCodes];
          return { ...zone, country_codes: [...zone.country_codes] };
        },
        deleteShippingZone: async (id: string) => {
          const zone = zones.find((z) => z.id === id);
          if (!zone) throw new DomainError({ code: 30001, message: `Shipping zone not found: ${id}` });
          const count = options.filter((o) => o.zone_id === id).length;
          if (count > 0) {
            throw new DomainError({
              code: 30002,
              message: `发货区「${zone.name}」下还有 ${count} 个运费方式，请先删除或改到别的区`,
            });
          }
          zones.splice(zones.indexOf(zone), 1);
        },
        listShippingOptionsByZone: async (zoneId: string) =>
          options.filter((o) => o.zone_id === zoneId),
        createShippingOption: async (input: {
          zoneId: string;
          name: string;
          carrier?: string | null;
          type: "flat" | "free_over";
          amountMinor: bigint;
          currencyCode: string;
          freeOverThresholdMinor?: bigint | null;
        }) => {
          if (!zones.some((z) => z.id === input.zoneId)) {
            throw new DomainError({ code: 30001, message: `Shipping zone not found: ${input.zoneId}` });
          }
          if (input.type === "free_over" && !(input.freeOverThresholdMinor ?? 0n > 0n)) {
            throw new DomainError({
              code: 20001,
              message: "满额包邮必须填写门槛金额（大于 0）；要全场包邮请把固定价设为 0",
            });
          }
          const option = {
            id: `shipopt_${++seq}`,
            zone_id: input.zoneId,
            name: input.name,
            carrier: input.carrier ?? null,
            type: input.type,
            amount_minor: input.amountMinor,
            currency_code: input.currencyCode,
            is_active: true,
            free_over_threshold_minor:
              input.type === "free_over" ? (input.freeOverThresholdMinor ?? null) : null,
          };
          options.push(option);
          return option;
        },
        updateShippingOption: async (
          id: string,
          input: {
            name?: string;
            carrier?: string | null;
            type?: "flat" | "free_over";
            amountMinor?: bigint;
            freeOverThresholdMinor?: bigint | null;
            isActive?: boolean;
          },
        ) => {
          const option = options.find((o) => o.id === id);
          if (!option) throw new DomainError({ code: 30001, message: `Shipping option not found: ${id}` });
          if (input.name !== undefined) option.name = input.name;
          if (input.carrier !== undefined) option.carrier = input.carrier;
          if (input.type !== undefined) option.type = input.type;
          if (input.amountMinor !== undefined) option.amount_minor = input.amountMinor;
          if (input.isActive !== undefined) option.is_active = input.isActive;
          if (input.freeOverThresholdMinor !== undefined) {
            option.free_over_threshold_minor = input.freeOverThresholdMinor;
          }
          if (option.type !== "free_over") option.free_over_threshold_minor = null;
          return option;
        },
        deleteShippingOption: async (id: string) => {
          const idx = options.findIndex((o) => o.id === id);
          if (idx >= 0) options.splice(idx, 1);
        },
      };
    })(),
    theme: {
      getSettings: async () => ({ ...state.theme }),
      updateSettings: async (patch: Record<string, unknown>) => {
        state.theme = { ...state.theme, ...patch };
        return { ...state.theme };
      },
    },
    // 通知替身：只够跑通路由语义（开关、不回显密码、失败可见）。
    notification: (() => {
      const settings = {
        enabled: false,
        from_name: "",
        from_email: "",
        smtp_host: "",
        smtp_port: 587,
        smtp_secure: false,
        smtp_user: "",
        smtp_password_set: false,
        order_confirmation_enabled: true,
        shipment_enabled: true,
        stock_alert_enabled: true,
        storefront_url: "",
      };
      const rows: Array<Record<string, unknown>> = [];
      let seq = 0;
      return {
        getSettings: async () => ({ ...settings }),
        updateSettings: async (patch: Record<string, unknown>) => {
          // 与真实服务一致：密码只留 set 标记，绝不回显
          const { smtp_password: _pw, ...rest } = patch as { smtp_password?: string };
          Object.assign(settings, rest);
          if ("smtp_password" in patch) {
            settings.smtp_password_set = Boolean(_pw);
          }
          return { ...settings };
        },
        sendTest: async (to: string) => {
          if (!settings.smtp_host) {
            throw new DomainError({ code: 31003, message: "邮件发送失败：未填写 SMTP 服务器地址" });
          }
          if (to.includes("fail")) {
            throw new DomainError({ code: 31003, message: "邮件发送失败：SMTP 拒收" });
          }
          rows.push({ id: `ntf_${++seq}`, template: "test", to_email: to, status: "sent" });
        },
        enqueueOrderConfirmation: async (payload: { orderId: string; email: string }) => {
          rows.push({
            id: `ntf_${++seq}`,
            template: "order_confirmation",
            to_email: payload.email,
            subject: "订单已确认",
            status: "pending",
            attempts: 0,
            error: null,
            order_id: payload.orderId,
            created_at: new Date().toISOString(),
            sent_at: null,
          });
        },
        enqueueShipmentNotification: async (
          fulfillmentId: string,
          payload: { orderId: string; email: string },
        ) => {
          rows.push({
            id: `ntf_${++seq}`,
            template: "shipment_notification",
            to_email: payload.email,
            subject: "订单已发货",
            status: "pending",
            attempts: 0,
            error: null,
            order_id: `${payload.orderId}:${fulfillmentId}`,
            created_at: new Date().toISOString(),
            sent_at: null,
          });
        },
        list: async (q: { limit: number; offset: number; status?: string }) => {
          const all = rows.filter((r) => (q.status ? r.status === q.status : true));
          return { items: all.slice(q.offset, q.offset + q.limit), count: all.length };
        },
        resend: async (id: string) => {
          const row = rows.find((r) => r.id === id);
          if (!row) {
            throw new DomainError({ code: 31001, message: `通知记录不存在：${id}` });
          }
          row.status = settings.smtp_host.includes("127.0.0.1") ? "failed" : "sent";
          row.error = row.status === "failed" ? "connect ECONNREFUSED" : null;
          row.sent_at = row.status === "sent" ? new Date().toISOString() : null;
          return row;
        },
        claimPending: async () => [],
        deliverRow: async () => {},
      };
    })(),
  };
}
