/**
 * @mall/sdk — 运行时 API 客户端（店面 + 后台共用）。
 * 统一处理 { code, data, message } 信封、错误码→展示文案、鉴权头、401 自动刷新一次。
 * 金额一律 amount_minor（number，int64 安全范围内）；展示层换算见 @mall/ui formatMoney。
 */
import type {
  AddLineItemRequest,
  AddVoucherCodesRequest,
  AdjustGiftCardRequest,
  CapturePaymentRequest,
  ChangePasswordRequest,
  CreateCartRequest,
  CreateFulfillmentRequest,
  CreateGiftCardRequest,
  CreateInventoryTransferRequest,
  CreatePaymentSessionRequest,
  CreateProductRequest,
  CreatePromotionRequest,
  CreateRefundRequest,
  CreateShipmentRequest,
  CreateStockLocationRequest,
  CreateVariantRequest,
  CreateVoucherRequest,
  LoginRequest,
  PutPricesRequest,
  PromotionRuleInput,
  RegisterRequest,
  SetGiftCardCodesRequest,
  SetShippingMethodRequest,
  SetVoucherCodesRequest,
  UpdateGiftCardRequest,
  UpdateInventoryLevelRequest,
  UpdateLineItemRequest,
  UpdatePaymentProviderRequest,
  UpdateProductRequest,
  UpdatePromotionRequest,
  UpdateSettingsRequest,
  UpdateStockLocationRequest,
  UpdateThemeRequest,
  UpdateVariantRequest,
  UpdateVoucherRequest,
} from "./requests";
import type { Envelope, PaginatedResponse } from "@mall/types";

export interface ClientOptions {
  baseUrl: string;
  /** 店面公开端点用（标识 channel）；后台不传。 */
  publishableKey?: string;
  /** 访问令牌（登录后传入）；缺省则匿名。 */
  accessToken?: string;
  /** 401 后自动用 refresh 换新 access 的回调（返回新 access 或抛错）。 */
  onRefresh?: () => Promise<string>;
  fetch?: typeof fetch;
}

/** 统一错误：携带后端错误码与文案。 */
export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildQuery(q?: Query): string {
  if (!q) return "";
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

async function request<T>(
  method: string,
  path: string,
  opts: ClientOptions,
  body?: unknown,
  query?: Query,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.publishableKey) headers["x-publishable-key"] = opts.publishableKey;
    if (opts.accessToken) headers["authorization"] = `Bearer ${opts.accessToken}`;
    // 额外请求头（如 idempotency-key）：放在最后，允许覆盖默认头。
    if (extraHeaders) Object.assign(headers, extraHeaders);
    const fetcher = opts.fetch ?? fetch;
    return fetcher(`${opts.baseUrl}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let res = await doFetch();
  // 401 自动刷新一次（仅当配了 onRefresh）
  if (res.status === 401 && opts.onRefresh) {
    const next = await opts.onRefresh();
    opts.accessToken = next;
    res = await doFetch();
  }

  let payload: Envelope<T> | null = null;
  try {
    payload = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }
  if (payload && payload.code !== 0) {
    throw new ApiError(payload.code, payload.message || `业务错误 ${payload.code}`);
  }
  return (payload?.data ?? undefined) as T;
}

/** 店面客户端（x-publishable-key + 可选顾客 JWT）。 */
export function createStoreClient(opts: ClientOptions) {
  const base: ClientOptions = { fetch: opts.fetch, ...opts };
  const get = <T>(p: string, q?: Query) => request<T>("GET", p, base, undefined, q);
  const post = <T>(p: string, b?: unknown) => request<T>("POST", p, base, b);
  const patch = <T>(p: string, b?: unknown) => request<T>("PATCH", p, base, b);
  const put = <T>(p: string, b?: unknown) => request<T>("PUT", p, base, b);
  const del = <T>(p: string) => request<T>("DELETE", p, base);

  return {
    setAccessToken(t: string) {
      base.accessToken = t;
    },
    bootstrap: () => get("/api/v1/store/bootstrap"),
    listProducts: (q?: Query) => get("/api/v1/store/products", q),
    getProduct: (handle: string) => get(`/api/v1/store/products/${handle}`),
    listCategories: () => get("/api/v1/store/categories"),
    createCart: (b: CreateCartRequest) => post("/api/v1/store/carts", b),
    getCart: (id: string) => get(`/api/v1/store/carts/${id}`),
    addLineItem: (cartId: string, b: AddLineItemRequest) =>
      post(`/api/v1/store/carts/${cartId}/line-items`, b),
    updateLineItem: (cartId: string, lineId: string, b: UpdateLineItemRequest) =>
      patch(`/api/v1/store/carts/${cartId}/line-items/${lineId}`, b),
    deleteLineItem: (cartId: string, lineId: string) =>
      del(`/api/v1/store/carts/${cartId}/line-items/${lineId}`),
    listShippingOptions: (q?: Query) => get("/api/v1/store/shipping-options", q),
    /** 选运费：只传方案 id，运费金额由后端解析（铁律 13，防客户端指定运费）。 */
    setShippingMethod: (cartId: string, b: SetShippingMethodRequest) =>
      post(`/api/v1/store/carts/${cartId}/shipping-methods`, b),
    /** 输优惠券码/清码：覆盖式设置（只传码凭证，折扣金额由后端算，铁律 13）。 */
    setVoucherCodes: (cartId: string, b: SetVoucherCodesRequest) =>
      put(`/api/v1/store/carts/${cartId}/voucher-codes`, b),
    /** 输礼品卡码/清码：覆盖式设置（只传卡码凭证，抵扣金额由后端算，铁律 13）。 */
    getPromotionFeatures: () => get("/api/v1/store/promotions/features"),
    setGiftCardCodes: (cartId: string, b: SetGiftCardCodesRequest) =>
      put(`/api/v1/store/carts/${cartId}/gift-card-codes`, b),
    listPaymentProviders: (cartId: string) =>
      get("/api/v1/store/payment-providers", { cart_id: cartId }),
    createPaymentSession: (b: CreatePaymentSessionRequest) =>
      post("/api/v1/store/payment-sessions", b),
    /** 授权支付会话（创建 payment 记录）。 */
    authorizeSession: (sessionId: string) =>
      post(`/api/v1/store/payment-sessions/${sessionId}/authorize`),
    /** 扣款（幂等键必填）。 */
    capturePayment: (paymentId: string, b: CapturePaymentRequest) =>
      post(`/api/v1/store/payments/${paymentId}/capture`, b),
    /**
     * 结算下单（走 cart-complete workflow）。
     *
     * 幂等键必须放在 **Idempotency-Key 请求头**里 —— 后端
     * `POST /store/carts/:id/complete` 读的是 `req.headers["idempotency-key"]`，
     * 不是请求体。此前 SDK 形参接收了 idempotencyKey 却丢弃不用，
     * 后端只能退化成 `auto_${cartId}`（同一购物车永远同一个键）。
     */
    completeCart: (cartId: string, idempotencyKey?: string) =>
      request("POST", `/api/v1/store/carts/${cartId}/complete`, base, undefined, undefined, {
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      }),
    getOrder: (id: string) => get(`/api/v1/store/orders/${id}`),
    register: (b: RegisterRequest) => post("/api/v1/store/auth/register", b),
    login: (b: LoginRequest) => post("/api/v1/store/auth/login", b),
    refresh: (refreshToken: string) =>
      post("/api/v1/store/auth/refresh", { refresh_token: refreshToken }),
    logout: (refreshToken: string) =>
      post("/api/v1/store/auth/logout", { refresh_token: refreshToken }),
  };
}

/** 后台客户端（admin JWT + RBAC）。 */
export function createAdminClient(opts: ClientOptions) {
  const base: ClientOptions = { fetch: opts.fetch, ...opts };
  const get = <T>(p: string, q?: Query) => request<T>("GET", p, base, undefined, q);
  const post = <T>(p: string, b?: unknown) => request<T>("POST", p, base, b);
  const patch = <T>(p: string, b?: unknown) => request<T>("PATCH", p, base, b);
  const put = <T>(p: string, b?: unknown) => request<T>("PUT", p, base, b);
  const del = <T>(p: string) => request<T>("DELETE", p, base);

  return {
    setAccessToken(t: string) {
      base.accessToken = t;
    },
    login: (b: LoginRequest) => post("/api/v1/admin/auth/login", b),
    refresh: (refreshToken: string) =>
      post("/api/v1/admin/auth/refresh", { refresh_token: refreshToken }),
    logout: (refreshToken: string) =>
      post("/api/v1/admin/auth/logout", { refresh_token: refreshToken }),
    /**
     * 管理员自助改密：改密后端会撤销该管理员全部 refresh_token，
     * 不签发新 token，调用方需清本地会话并跳登录页。
     */
    changePassword: (b: ChangePasswordRequest) =>
      post("/api/v1/admin/auth/change-password", b),
    listProducts: (q?: Query) => get("/api/v1/admin/products", q),
    getProduct: (id: string) => get(`/api/v1/admin/products/${id}`),
    createProduct: (b: CreateProductRequest) => post("/api/v1/admin/products", b),
    updateProduct: (id: string, b: UpdateProductRequest) =>
      patch(`/api/v1/admin/products/${id}`, b),
    deleteProduct: (id: string) => del(`/api/v1/admin/products/${id}`),
    createVariant: (productId: string, b: CreateVariantRequest) =>
      post(`/api/v1/admin/products/${productId}/variants`, b),
    updateVariant: (variantId: string, b: UpdateVariantRequest) =>
      patch(`/api/v1/admin/variants/${variantId}`, b),
    putPrices: (variantId: string, b: PutPricesRequest) =>
      put(`/api/v1/admin/variants/${variantId}/prices`, b),
    listOrders: (q?: Query) => get("/api/v1/admin/orders", q),
    getOrder: (id: string) => get(`/api/v1/admin/orders/${id}`),
    cancelOrder: (id: string) => post(`/api/v1/admin/orders/${id}/cancel`),
    refundOrder: (id: string, b: CreateRefundRequest) =>
      post(`/api/v1/admin/orders/${id}/refunds`, b),
    createFulfillment: (orderId: string, b: CreateFulfillmentRequest) =>
      post(`/api/v1/admin/orders/${orderId}/fulfillments`, b),
    createShipment: (fulfillmentId: string, b: CreateShipmentRequest) =>
      post(`/api/v1/admin/fulfillments/${fulfillmentId}/shipments`, b),
    listCustomers: (q?: Query) => get("/api/v1/admin/customers", q),
    listInventoryItems: (q?: Query) => get("/api/v1/admin/inventory-items", q),
    updateInventoryLevel: (levelId: string, b: UpdateInventoryLevelRequest) =>
      put(`/api/v1/admin/inventory-levels/${levelId}`, b),
    // —— 多仓（ADR-013）：仓库 / 按仓库存行 / 调拨 ——
    listStockLocations: () => get("/api/v1/admin/stock-locations"),
    createStockLocation: (b: CreateStockLocationRequest) =>
      post("/api/v1/admin/stock-locations", b),
    updateStockLocation: (id: string, b: UpdateStockLocationRequest) =>
      patch(`/api/v1/admin/stock-locations/${id}`, b),
    listInventoryLevels: (q?: Query) => get("/api/v1/admin/inventory-levels", q),
    /** 订单预留明细（含仓）：后台按仓拆发货单前选仓用。 */
    listOrderFulfillments: (orderId: string) =>
      get(`/api/v1/admin/orders/${orderId}/fulfillments`),
    listOrderReservations: (orderId: string) =>
      get(`/api/v1/admin/orders/${orderId}/reservations`),
    listInventoryTransfers: (q?: Query) => get("/api/v1/admin/inventory-transfers", q),
    createInventoryTransfer: (b: CreateInventoryTransferRequest) =>
      post("/api/v1/admin/inventory-transfers", b),
    completeInventoryTransfer: (id: string) =>
      post(`/api/v1/admin/inventory-transfers/${id}/complete`),
    cancelInventoryTransfer: (id: string) =>
      post(`/api/v1/admin/inventory-transfers/${id}/cancel`),
    getSettings: () => get("/api/v1/admin/settings"),
    updateSettings: (b: UpdateSettingsRequest) => patch("/api/v1/admin/settings", b),
    getTheme: () => get("/api/v1/admin/settings/theme"),
    updateTheme: (b: UpdateThemeRequest) => put("/api/v1/admin/settings/theme", b),
    getPaymentProviders: () => get("/api/v1/admin/settings/payment-providers"),
    updatePaymentProvider: (id: string, b: UpdatePaymentProviderRequest) =>
      put(`/api/v1/admin/settings/payment-providers/${id}`, b),
    // —— 促销（阶段 6）——
    getMarketingFeatures: () => get("/api/v1/admin/promotions/features"),
    setMarketingFeature: (feature: "promotion" | "voucher" | "gift_card", enabled: boolean) =>
      put(`/api/v1/admin/promotions/features/${feature}`, { enabled }),
    listPromotions: (q?: Query) => get("/api/v1/admin/promotions", q),
    createPromotion: (b: CreatePromotionRequest) => post("/api/v1/admin/promotions", b),
    getPromotion: (id: string) => get(`/api/v1/admin/promotions/${id}`),
    updatePromotion: (id: string, b: UpdatePromotionRequest) =>
      put(`/api/v1/admin/promotions/${id}`, b),
    deletePromotion: (id: string) => del(`/api/v1/admin/promotions/${id}`),
    activatePromotion: (id: string) => post(`/api/v1/admin/promotions/${id}/activate`),
    deactivatePromotion: (id: string) => post(`/api/v1/admin/promotions/${id}/deactivate`),
    addPromotionRule: (id: string, b: PromotionRuleInput) =>
      post(`/api/v1/admin/promotions/${id}/rules`, b),
    deletePromotionRule: (ruleId: string) =>
      del(`/api/v1/admin/promotions/rules/${ruleId}`),
    listVouchers: (q?: Query) => get("/api/v1/admin/promotions/vouchers", q),
    createVoucher: (b: CreateVoucherRequest) => post("/api/v1/admin/promotions/vouchers", b),
    getVoucher: (id: string) => get(`/api/v1/admin/promotions/vouchers/${id}`),
    updateVoucher: (id: string, b: UpdateVoucherRequest) =>
      put(`/api/v1/admin/promotions/vouchers/${id}`, b),
    enableVoucher: (id: string) => post(`/api/v1/admin/promotions/vouchers/${id}/enable`),
    disableVoucher: (id: string) => post(`/api/v1/admin/promotions/vouchers/${id}/disable`),
    listVoucherCodes: (id: string) => get(`/api/v1/admin/promotions/vouchers/${id}/codes`),
    addVoucherCodes: (id: string, b: AddVoucherCodesRequest) =>
      post(`/api/v1/admin/promotions/vouchers/${id}/codes`, b),
    deleteVoucherCode: (id: string, codeId: string) =>
      del(`/api/v1/admin/promotions/vouchers/${id}/codes/${codeId}`),
    enableVoucherCode: (id: string, codeId: string) =>
      post(`/api/v1/admin/promotions/vouchers/${id}/codes/${codeId}/enable`),
    disableVoucherCode: (id: string, codeId: string) =>
      post(`/api/v1/admin/promotions/vouchers/${id}/codes/${codeId}/disable`),
    listGiftCards: (q?: Query) => get("/api/v1/admin/promotions/gift-cards", q),
    createGiftCard: (b: CreateGiftCardRequest) => post("/api/v1/admin/promotions/gift-cards", b),
    getGiftCard: (id: string) => get(`/api/v1/admin/promotions/gift-cards/${id}`),
    updateGiftCard: (id: string, b: UpdateGiftCardRequest) =>
      put(`/api/v1/admin/promotions/gift-cards/${id}`, b),
    enableGiftCard: (id: string) => post(`/api/v1/admin/promotions/gift-cards/${id}/enable`),
    disableGiftCard: (id: string) => post(`/api/v1/admin/promotions/gift-cards/${id}/disable`),
    adjustGiftCard: (id: string, b: AdjustGiftCardRequest) =>
      post(`/api/v1/admin/promotions/gift-cards/${id}/adjust`, b),
    listGiftCardEvents: (id: string) => get(`/api/v1/admin/promotions/gift-cards/${id}/events`),
  };
}

export type { PaginatedResponse };
