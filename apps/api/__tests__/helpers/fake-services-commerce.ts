/**
 * 业务模块的测试替身（mock services）——交易侧：顾客 / 文件 / 认证 / 库存 /
 * 购物车 / 订单 / 履约 / 主题。
 */
import { errors } from "@mall/core";
import { checkPasswordStrength } from "@mall/auth";
import type { FakeServicesState } from "./fake-services-state.js";

export function makeFakeCommerceServices(state: FakeServicesState) {
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
            permissions: ["products", "orders"],
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
      listStockLocations: async () => [{ id: "loc_1", name: "默认仓库", priority: 0 }],
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
      }),
      createCart: async () => ({ id: "cart_1" }),
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
      createFulfillment: async () => ({
        id: "fulf_1",
        order_id: "ord_1",
        status: "fulfilled",
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
