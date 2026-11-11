/**
 * 业务模块的测试替身（mock services）——交易侧：顾客 / 文件 / 认证 / 库存 /
 * 购物车 / 订单 / 履约 / 主题。
 */
import { errors } from "@mall/core";
import { checkPasswordStrength } from "@mall/auth";
import type { FakeServicesState } from "./fake-services-state.js";

export function makeFakeCommerceServices(state: FakeServicesState) {
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
  const promotion = {
    getFeatureFlags: async () => ({ ...featureFlags }),
    setFeatureEnabled: async (feature: string, enabled: boolean) => {
      featureFlags[feature] = enabled;
    },
    listVouchers: async ({ limit, offset }: { limit: number; offset: number }) => {
      const items = [...vouchers.values()].slice(offset, offset + limit);
      return { items, count: vouchers.size };
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
    listGiftCards: async ({ limit, offset }: { limit: number; offset: number }) => {
      const items = [...giftCards.values()].slice(offset, offset + limit);
      return { items, count: giftCards.size };
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
    listPromotions: async ({ limit, offset }: { limit: number; offset: number }) => {
      const items = [...promotions.values()].slice(offset, offset + limit);
      return { items, count: promotions.size };
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
    items: [orderItem],
    shipping_method: null,
  };

  return {
    promotion,
    customer: {
      retrieveCustomer: async () => ({
        id: "cust_1",
        email: "a@b.com",
        first_name: null,
        last_name: null,
        phone: null,
        metadata: null,
      }),
      listAddresses: async () => [],
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
      deleteFile: async () => {},
    },
    auth: {
      verifyAccessToken: async (token: string) => {
        if (token === "admin") {
          return { sub: "adm_1", scope: "admin", roles: ["admin"], permissions: "all" };
        }
        if (token === "staff") {
          return {
            sub: "adm_2",
            scope: "admin",
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
      seedRoles: async () => {},
    },
    inventory: {
      getAvailability: async ({ variantIds }: { variantIds: string[] }) =>
        variantIds.map((id) => ({ variantId: id, available: 12 })),
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
      listInventoryLevels: async (q?: { locationId?: string }) => ({
        items: [
          {
            id: "invlvl_1",
            inventory_item_id: "invitem_1",
            sku: "SKU-1",
            stock_location_id: q?.locationId ?? "loc_1",
            stocked_quantity: 10,
            reserved_quantity: 0,
            available_quantity: 10,
          },
        ],
        count: 1,
      }),
      listReservationIdsByOrder: async () => ["rsv_1"],
      listReservationsByOrder: async (orderId: string) => [
        {
          id: "rsv_1",
          inventory_item_id: "invitem_1",
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
    cart: {
      retrieveCart: async () => ({
        id: "cart_1",
        channel_id: "chn_cn",
        region_id: "reg_1",
        currency_code: "CNY",
        customer_id: null,
        email: "a@b.com",
        status: "open",
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
    order: {
      retrieveOrder: async () => order,
      /*
       * 真实 listOrders 按 cartId 过滤：cart_1 尚未下单时返回空，
       * 下单成功后（workflow 里 createOrder 返回 ord_1）才有记录。
       * 这里用 state 里的一个布尔位模拟「是否已下单」，保证幂等重放测试能验证「已下单 → 返回 200」。
       */
      listOrders: async (q?: { cartId?: string }) =>
        state.orderCreated && (!q?.cartId || q.cartId === "cart_1")
          ? { items: [order], count: 1 }
          : { items: [], count: 0 },
      cancelOrder: async () => {},
      createRefundRequest: async () => ({
        orderId: "ord_1",
        amountMinor: 10700n,
        currencyCode: "CNY",
        reason: "r",
      }),
      markRefundSettled: async () => order,
    },
    fulfillment: {
      listShippingOptions: async () => [],
      createFulfillment: async (input: { stockLocationId?: string }) => ({
        id: "fulf_1",
        order_id: "ord_1",
        stock_location_id: input.stockLocationId ?? "loc_1",
        status: "fulfilled",
        reservation_ids: ["rsv_1"],
        tracking_links: null,
      }),
      listByOrder: async () => [
        {
          id: "fulf_1",
          order_id: "ord_1",
          stock_location_id: "loc_1",
          status: "shipped",
          reservation_ids: ["rsv_1"],
          tracking_links: [{ carrier: "顺丰", number: "SF1" }],
        },
      ],
      addShipment: async () => ({
        id: "ship_1",
        fulfillment_id: "fulf_1",
        carrier_name: "顺丰",
        tracking_number: "SF1",
        shipped_at: new Date().toISOString(),
      }),
      calculateShippingPrice: async () => ({ amountMinor: 0n, currencyCode: "CNY" }),
    },
    theme: {
      getSettings: async () => ({ ...state.theme }),
      updateSettings: async (patch: Record<string, unknown>) => {
        state.theme = { ...state.theme, ...patch };
        return { ...state.theme };
      },
    },
  };
}
