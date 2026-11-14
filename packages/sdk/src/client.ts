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
  CreateCategoryRequest,
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
  UpdateCategoryRequest,
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
import type { ShippingAddressInput } from "./store";
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
    // country：税率按收货国家解析（ADR-018），合计随所选国家变
    /** 设置购物车收货国家：服务端据此自动算运费与税（ADR-019）。 */
    setCartAddress: (cartId: string, country: string) =>
      put(`/api/v1/store/carts/${cartId}/address`, { country }),
    /** 结账可选国家（内置常用 ∪ 已配税率），带各自实际税率（ADR-018）。 */
    getCheckoutCountries: () => get("/api/v1/store/checkout/countries"),
    getCart: (id: string, country?: string) =>
      get(`/api/v1/store/carts/${id}`, country ? { country } : undefined),
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
    /** 进行中的秒杀活动（ADR-099）：只含还有剩余的活动。 */
    listFlashSales: () => get("/api/v1/store/flash-sales"),
    /** 拼团（ADR-100）：进行中的活动 / 参团 / 我的拼团 / 成团领券。 */
    listGroupBuys: () => get("/api/v1/store/group-buys"),
    joinGroupBuy: (id: string) => post(`/api/v1/store/group-buys/${id}/join`),
    listMyGroupBuys: () => get("/api/v1/store/group-buys/mine"),
    claimGroupBuyVoucher: (id: string) => post(`/api/v1/store/group-buys/${id}/voucher`),
    /** 我的积分（ADR-093）：余额 + 最近流水。 */
    getStorePoints: () => get("/api/v1/store/points"),
    /** 可领取的店铺券（匿名可读；登录后带 collected 标记）。 */
    listPublicVouchers: () => get("/api/v1/store/vouchers"),
    /** 本商品可用的店铺券（ADR-071）：商品页领券区只摆这个商品能用得上的。 */
    listProductVouchers: (handle: string) =>
      get(`/api/v1/store/products/${handle}/vouchers`),
    /** 领取一张店铺券（返回专属券码，重复领取幂等）。 */
    collectVoucher: (id: string) => post(`/api/v1/store/vouchers/${id}/collect`, {}),
    /** 我的卡券（未用在前）。 */
    listMyVouchers: () => get("/api/v1/store/customer/vouchers"),
    /** 微页面（ADR-082）：只取已发布。 */
    getStorePage: (slug: string) => get(`/api/v1/store/pages/${slug}`),
    /** 商品评价（匿名可读）。 */
    listProductReviews: (handle: string, q?: Query) =>
      get(`/api/v1/store/products/${handle}/reviews`, q),
    /** 提交评价（需登录；一单一商品一条）。 */
    createReview: (b: { order_id: string; product_id: string; rating: number; content?: string }) =>
      post("/api/v1/store/reviews", b),
    /** 取消未付款订单（ADR-075）：只释放库存，不涉及钱。 */
    cancelOrder: (id: string) => post(`/api/v1/store/orders/${id}/cancel`, {}),
    /** 确认收货（fulfilled / delivered → completed）。 */
    confirmOrderReceipt: (id: string) =>
      post(`/api/v1/store/orders/${id}/confirm-receipt`, {}),
    /** 我的收藏（商品卡片，分页）。 */
    listMyFavorites: (q?: Query) => get("/api/v1/store/customer/favorites", q),
    /** 收藏的商品 id（详情页判断是否已收藏）。 */
    listMyFavoriteIds: () => get("/api/v1/store/customer/favorites/ids"),
    /** 收藏（幂等）。 */
    addFavorite: (productId: string) =>
      post(`/api/v1/store/customer/favorites/${productId}`, {}),
    /** 取消收藏（幂等）。 */
    removeFavorite: (productId: string) =>
      del(`/api/v1/store/customer/favorites/${productId}`),
    setGiftCardCodes: (cartId: string, b: SetGiftCardCodesRequest) =>
      put(`/api/v1/store/carts/${cartId}/gift-card-codes`, b),
    /** 用积分抵扣（ADR-094）：只传点数。 */
    setPointsToUse: (cartId: string, points: number) =>
      put(`/api/v1/store/carts/${cartId}/points`, { points }),
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
    completeCart: (
      cartId: string,
      idempotencyKey?: string,
      /**
       * 收货地址：订单要存下来，税率也按其中的国家解析（ADR-018）。
       * customer_note：给卖家留言（ADR-050），顾客与商家都能看到。
       */
      body?: { shipping_address?: ShippingAddressInput; customer_note?: string },
    ) =>
      request("POST", `/api/v1/store/carts/${cartId}/complete`, base, body ?? {}, undefined, {
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      }),
    // —— 顾客认证 ——
    /** 店铺开放的注册方式（店面据此渲染邮箱表单还是手机号表单）。 */
    getCustomerAuthSettings: () => get("/api/v1/store/auth/settings"),
    /**
     * 邮箱注册：邮箱 + 密码 + 手机号（必填）+ 验证码。
     * 返回 identity_id + customer_id，token 需再调 login。
     */
    registerCustomer: (b: {
      email: string;
      password: string;
      phone: string;
      /** 验证码发到哪：邮箱还是短信。 */
      channel: "sms" | "email";
      code: string;
      first_name?: string;
      last_name?: string;
    }) => post("/api/v1/store/auth/register", b),
    /** 密码登录：identifier 可以是邮箱或手机号。 */
    loginCustomer: (b: { identifier: string; password: string }) =>
      post("/api/v1/store/auth/login", b),
    /** 发验证码（短信或邮件）。开发环境响应带 dev_code 便于自测。 */
    sendCustomerCode: (b: {
      channel?: "sms" | "email";
      target: string;
      purpose?: "login" | "register" | "reset";
    }) => post("/api/v1/store/auth/codes", { channel: "sms", ...b }),
    /** 手机号 + 验证码登录（手机号不存在时自动注册）。 */
    loginCustomerWithPhone: (b: { phone: string; code: string }) =>
      post("/api/v1/store/auth/login/phone", b),
    /** 忘记密码第一步：按账号类型发验证码（邮箱发邮件 / 手机号发短信）。 */
    forgotCustomerPassword: (b: { identifier: string }) =>
      post("/api/v1/store/auth/password/forgot", b),
    /** 忘记密码第二步：验证码 + 新密码；不签发 token，需重新登录。 */
    resetCustomerPassword: (b: { identifier: string; code: string; new_password: string }) =>
      post("/api/v1/store/auth/password/reset", b),
    refreshCustomer: (b: { refresh_token: string }) =>
      post("/api/v1/store/auth/refresh", b),
    logoutCustomer: (b: { refresh_token: string }) =>
      post("/api/v1/store/auth/logout", b),
    /** 当前登录顾客资料（刷新页面后恢复「我是谁」）。 */
    getCustomerMe: () => get("/api/v1/store/customer/me"),
    // —— 我的订单 ——
    /** 我的订单列表：只看 token 里的 customerId，不接受 query 传顾客 id。 */
    listMyOrders: (q?: Query) => get("/api/v1/store/orders", q),
    getOrder: (id: string) => get(`/api/v1/store/orders/${id}`),
    /**
     * 顾客申请退款：只传原因与售后类型，金额由服务端按订单实付取。
     * resolution 缺省 refund_only（仅退款）；return_refund 需订单已发货。
     */
    requestOrderRefund: (
      id: string,
      b: {
        reason: string;
        resolution?: "refund_only" | "return_refund" | "exchange";
        exchange_variant_id?: string;
        exchange_quantity?: number;
      },
    ) => post(`/api/v1/store/orders/${id}/refund-requests`, b),
    listOrderRefunds: (id: string) => get(`/api/v1/store/orders/${id}/refund-requests`),
    /** 申请开票（ADR-098）：只传抬头信息，金额由服务端取订单总额。 */
    requestOrderInvoice: (
      id: string,
      b: {
        type: "personal" | "company";
        title: string;
        tax_id?: string;
        email?: string;
        remark?: string;
      },
    ) => post(`/api/v1/store/orders/${id}/invoice`, b),
    /** 该订单的开票进度（未申请时返回 null）。 */
    getOrderInvoice: (id: string) => get(`/api/v1/store/orders/${id}/invoice`),
    /** 买家提交退货物流（商家同意退货后，ADR-051）。 */
    submitReturnShipment: (refundId: string, b: { carrier: string; tracking_number: string }) =>
      post(`/api/v1/store/refund-requests/${refundId}/return-shipment`, b),
    /** 我的评价（自己写过的，含被隐藏的）。 */
    listMyReviews: (q?: Query) => get("/api/v1/store/customer/reviews", q),
    /**
     * 登记到货提醒（ADR-059）：售罄商品补货后发邮件。
     * 登录顾客可省略 email（用账号邮箱）；游客必填。
     */
    subscribeStockAlert: (b: { product_id: string; variant_id: string; email?: string }) =>
      post("/api/v1/store/stock-alerts", b),
    /**
     * 顾客自助改密（ADR-055）。改完该身份的全部会话失效，前端要引导重新登录。
     * 身份取 token，不接受 body 传 identity_id。
     */
    changeCustomerPassword: (b: { current_password: string; new_password: string }) =>
      post("/api/v1/store/auth/password/change", b),
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
    /** 工作台：今日支付、待发货、待退款、最近订单（ADR-030）。 */
    getDashboard: () => get("/api/v1/admin/dashboard"),
    /** 统计报表（ADR-097）：近 30 天交易汇总 + 状态分布 + 销量排行。 */
    getStatistics: () => get("/api/v1/admin/statistics"),
    /** 微页面（ADR-082）。 */
    listMicroPages: () => get("/api/v1/admin/settings/pages"),
    createMicroPage: (
      b: { slug: string; title: string; content?: string; content_format?: "plain" | "html"; is_published?: boolean },
    ) => post("/api/v1/admin/settings/pages", b),
    updateMicroPage: (
      id: string,
      b: { slug?: string; title?: string; content?: string; content_format?: "plain" | "html"; is_published?: boolean },
    ) => patch(`/api/v1/admin/settings/pages/${id}`, b),
    deleteMicroPage: (id: string) => del(`/api/v1/admin/settings/pages/${id}`),
    /** 店面微页面（只给已发布）。 */
    getStorePage: (slug: string) => get(`/api/v1/store/pages/${slug}`),
    /** 链接选择器（ADR-081）：按关键字找商品/分类，返回可直接用的站内路径。 */
    listLinkTargets: (q: { type: "product" | "category" | "page"; q?: string }) =>
      get("/api/v1/admin/settings/link-targets", q),
    /** 轮播图（ADR-080）：装修入口管理首页大图。 */
    listBanners: () => get("/api/v1/admin/settings/banners"),
    createBanner: (b: { image_file_id: string; link?: string | null; sort_order?: number }) =>
      post("/api/v1/admin/settings/banners", b),
    updateBanner: (id: string, b: { image_file_id?: string; link?: string | null; is_active?: boolean }) =>
      patch(`/api/v1/admin/settings/banners/${id}`, b),
    deleteBanner: (id: string) => del(`/api/v1/admin/settings/banners/${id}`),
    /** 应用接入状态（ADR-084）：支付/邮件/渠道。 */
    getAppsStatus: () => get("/api/v1/admin/apps/status"),
    /** 清理超时未付款订单（ADR-087）：人工触发，释放库存。 */
    expireUnpaidOrders: (b: { minutes?: number }) =>
      post("/api/v1/admin/maintenance/expire-unpaid", b),
    /** 维护：系统探针 + 邮件队列 + 数据规模 + 最近审计（ADR-076）。 */
    getMaintenanceStatus: () => get("/api/v1/admin/maintenance/status"),
    /** 评价管理（ADR-042）。 */
    listReviews: (q?: Query) => get("/api/v1/admin/reviews", q),
    setReviewVisible: (id: string, visible: boolean) =>
      patch(`/api/v1/admin/reviews/${id}`, { is_visible: visible }),
    replyReview: (id: string, content: string) =>
      put(`/api/v1/admin/reviews/${id}/reply`, { content }),
    listProducts: (q?: Query) => get("/api/v1/admin/products", q),
    getProduct: (id: string) => get(`/api/v1/admin/products/${id}`),
    createProduct: (b: CreateProductRequest) => post("/api/v1/admin/products", b),
    updateProduct: (id: string, b: UpdateProductRequest) =>
      patch(`/api/v1/admin/products/${id}`, b),
    deleteProduct: (id: string) => del(`/api/v1/admin/products/${id}`),
    /** 批量上架/下架/删除，返回实际影响条数。 */
    bulkProductAction: (b: {
      ids: string[];
      action: "publish" | "unpublish" | "delete";
    }) => post("/api/v1/admin/products/bulk", b),
    /** 整组替换商品图片；第一张即主图。 */
    replaceProductImages: (id: string, b: { file_ids: string[] }) =>
      put(`/api/v1/admin/products/${id}/images`, b),
    // —— 商品分类（ADR-028）——
    listCategories: () => get("/api/v1/admin/categories"),
    createCategory: (b: CreateCategoryRequest) => post("/api/v1/admin/categories", b),
    updateCategory: (id: string, b: UpdateCategoryRequest) =>
      patch(`/api/v1/admin/categories/${id}`, b),
    deleteCategory: (id: string) => del(`/api/v1/admin/categories/${id}`),
    /** 上传文件（JSON + base64，后端限制 20MB）。 */
    uploadFile: (b: { filename: string; content_type: string; data_base64: string }) =>
      post("/api/v1/admin/files", b),
    createVariant: (productId: string, b: CreateVariantRequest) =>
      post(`/api/v1/admin/products/${productId}/variants`, b),
    updateVariant: (variantId: string, b: UpdateVariantRequest) =>
      patch(`/api/v1/admin/variants/${variantId}`, b),
    putPrices: (variantId: string, b: PutPricesRequest) =>
      put(`/api/v1/admin/variants/${variantId}/prices`, b),
    listOrders: (q?: Query) => get("/api/v1/admin/orders", q),
    getOrder: (id: string) => get(`/api/v1/admin/orders/${id}`),
    /** 商家内部备注（仅后台可见）。 */
    setOrderNote: (id: string, b: { note: string | null }) =>
      put(`/api/v1/admin/orders/${id}/note`, b),
    // —— 退款管理 ——
    listRefundRequests: (q?: Query) => get("/api/v1/admin/refund-requests", q),
    approveRefundRequest: (id: string, b: { note?: string }) =>
      post(`/api/v1/admin/refund-requests/${id}/approve`, b),
    rejectRefundRequest: (id: string, b: { note: string }) =>
      post(`/api/v1/admin/refund-requests/${id}/reject`, b),
    /** 确认收到退货并退款（退货退款的打款关卡，ADR-051）。 */
    receiveReturn: (id: string, b: { note?: string }) =>
      post(`/api/v1/admin/refund-requests/${id}/receive-return`, b),
    /** 换货（ADR-090）：同意/确认收货/发出，全程不打款。 */
    agreeExchange: (id: string, b: { note?: string }) =>
      post(`/api/v1/admin/refund-requests/${id}/agree-exchange`, b),
    receiveExchange: (id: string, b: { note?: string }) =>
      post(`/api/v1/admin/refund-requests/${id}/receive-exchange`, b),
    shipExchange: (id: string, b: { carrier: string; tracking_number: string }) =>
      post(`/api/v1/admin/refund-requests/${id}/ship-exchange`, b),
    // —— 发票管理（ADR-098）——
    // —— 限时秒杀（ADR-099）——
    // —— 拼团（ADR-100）——
    listGroupBuys: (q?: Query) => get("/api/v1/admin/group-buys", q),
    createGroupBuy: (b: {
      name: string;
      variant_id: string;
      title: string;
      original_price_minor: number;
      group_price_minor: number;
      team_size: number;
      starts_at: string;
      ends_at: string;
    }) => post("/api/v1/admin/group-buys", b),
    setGroupBuyStatus: (id: string, status: "active" | "ended") =>
      post(`/api/v1/admin/group-buys/${id}/status`, { status }),
    listFlashSales: (q?: Query) => get("/api/v1/admin/flash-sales", q),
    createFlashSale: (b: {
      name: string;
      starts_at: string;
      ends_at: string;
      items: Array<{
        variant_id: string;
        title: string;
        original_price_minor: number;
        flash_price_minor: number;
        stock: number;
      }>;
    }) => post("/api/v1/admin/flash-sales", b),
    setFlashSaleStatus: (id: string, status: "active" | "ended") =>
      post(`/api/v1/admin/flash-sales/${id}/status`, { status }),
    listInvoices: (q?: Query) => get("/api/v1/admin/invoices", q),
    issueInvoice: (id: string, b: { invoice_no: string; note?: string }) =>
      post(`/api/v1/admin/invoices/${id}/issue`, b),
    rejectInvoice: (id: string, b: { note: string }) =>
      post(`/api/v1/admin/invoices/${id}/reject`, b),
    /** 该订单的操作日志（审计流水，orders 权限即可查）。 */
    listOrderLogs: (id: string) => get(`/api/v1/admin/orders/${id}/logs`),
    cancelOrder: (id: string) => post(`/api/v1/admin/orders/${id}/cancel`),
    refundOrder: (id: string, b: CreateRefundRequest) =>
      post(`/api/v1/admin/orders/${id}/refunds`, b),
    createFulfillment: (orderId: string, b: CreateFulfillmentRequest) =>
      post(`/api/v1/admin/orders/${orderId}/fulfillments`, b),
    createShipment: (fulfillmentId: string, b: CreateShipmentRequest) =>
      post(`/api/v1/admin/fulfillments/${fulfillmentId}/shipments`, b),
    listCustomers: (q?: Query) => get("/api/v1/admin/customers", q),
    /** 客户详情：资料 + 地址 + 最近订单。 */
    getCustomer: (id: string) => get(`/api/v1/admin/customers/${id}`),
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
    getOrderFulfillmentPlan: (orderId: string) =>
      get(`/api/v1/admin/orders/${orderId}/fulfillment-plan`),
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
    /** 顾客账号设置（注册方式）。 */
    getAuthSettings: () => get("/api/v1/admin/settings/auth"),
    updateAuthSettings: (b: { register_mode?: "email" | "phone" }) =>
      put("/api/v1/admin/settings/auth", b),
    getPaymentProviders: () => get("/api/v1/admin/settings/payment-providers"),
    updatePaymentProvider: (id: string, b: UpdatePaymentProviderRequest) =>
      put(`/api/v1/admin/settings/payment-providers/${id}`, b),
    // —— 促销（阶段 6）——
    getTaxConfig: () => get("/api/v1/admin/tax"),
    updateTaxSettings: (body: {
      enabled?: boolean;
      tax_name?: string;
      prices_include_tax?: boolean;
    }) => put("/api/v1/admin/tax/settings", body),
    setDefaultTaxRate: (body: { name: string; rate_bps: number }) =>
      put("/api/v1/admin/tax/default-rate", body),
    setCountryTaxRate: (code: string, body: { name: string; rate_bps: number }) =>
      put(`/api/v1/admin/tax/country-rates/${code}`, body),
    deleteCountryTaxRate: (code: string) => del(`/api/v1/admin/tax/country-rates/${code}`),
    // —— 运费设置（运费模板 / 发货区 / 运费方式）——
    getShippingConfig: () => get("/api/v1/admin/shipping"),
    createShippingProfile: (body: { name: string }) =>
      post("/api/v1/admin/shipping/profiles", body),
    updateShippingProfile: (id: string, body: { name?: string }) =>
      patch(`/api/v1/admin/shipping/profiles/${id}`, body),
    deleteShippingProfile: (id: string) => del(`/api/v1/admin/shipping/profiles/${id}`),
    createShippingZone: (body: {
      name: string;
      country_codes: string[];
      profile_id?: string | null;
    }) => post("/api/v1/admin/shipping/zones", body),
    updateShippingZone: (
      id: string,
      body: { name?: string; country_codes?: string[] },
    ) => patch(`/api/v1/admin/shipping/zones/${id}`, body),
    deleteShippingZone: (id: string) => del(`/api/v1/admin/shipping/zones/${id}`),
    createShippingOption: (body: {
      zone_id: string;
      name: string;
      carrier?: string | null;
      type: "flat" | "free_over";
      amount_minor: number;
      free_over_threshold_minor?: number | null;
    }) => post("/api/v1/admin/shipping/options", body),
    updateShippingOption: (
      id: string,
      body: {
        name?: string;
        carrier?: string | null;
        type?: "flat" | "free_over";
        amount_minor?: number;
        free_over_threshold_minor?: number | null;
        is_active?: boolean;
      },
    ) => patch(`/api/v1/admin/shipping/options/${id}`, body),
    deleteShippingOption: (id: string) => del(`/api/v1/admin/shipping/options/${id}`),
    getSystemInfo: () => get("/api/v1/admin/system/info"),
    setSystemUpdateSource: (update_source_url: string) =>
      put("/api/v1/admin/system/settings", { update_source_url }),
    checkSystemUpdate: () => post("/api/v1/admin/system/check-update", {}),
    requestSystemUpgrade: (body: {
      version: string;
      tarball_url: string;
      sha256: string;
      confirm: true;
    }) => post("/api/v1/admin/system/upgrade", body),
    requestSystemBackup: (body: { label?: string }) => post("/api/v1/admin/system/backup", body),
    listSystemJobs: () => get("/api/v1/admin/system/jobs"),
    getSystemJob: (id: string) => get(`/api/v1/admin/system/jobs/${id}`),
    getNotificationSettings: () => get("/api/v1/admin/notifications/settings"),
    updateNotificationSettings: (body: Record<string, unknown>) =>
      put("/api/v1/admin/notifications/settings", body),
    sendTestNotification: (to: string) => post("/api/v1/admin/notifications/test", { to }),
    listNotifications: (q?: Query) => get("/api/v1/admin/notifications", q),
    resendNotification: (id: string) => post(`/api/v1/admin/notifications/${id}/resend`, {}),
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
