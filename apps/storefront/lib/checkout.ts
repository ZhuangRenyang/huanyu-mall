/**
 * 结账与支付结果的数据/逻辑层（双模式）。
 *
 * - mock（默认）：纯前端假数据 + sessionStorage 订单记录，无后端也能完整预览。
 * - live：真调 @mall/sdk（购物车 / 运费 / 支付方式 / 支付会话 / 订单查询），能真的收钱。
 *
 * live 模式的一次完整调用链（编排见 components/checkout/checkout-flow.tsx）：
 *   加购 → createCart → addLineItem / updateLineItem / deleteLineItem
 *   提交 → setShippingMethod → completeCart（幂等键） → createPaymentSession
 *   收款 → 支付商异步回调后端 → 前端轮询 getOrder 直到 payment_status = captured
 *
 * 金额一律用最小单位整数（分），展示换算见 @mall/ui 的 formatMoney。
 */
import { ApiError } from '@mall/sdk';
import type {
  Cart,
  Order,
  PaymentProviderOption,
  PaymentSession,
  ShippingAddressInput,
  ShippingOption,
} from '@mall/sdk';
import { getStoreClient } from './api';

export interface CheckoutForm {
  phone: string;
  email: string;
  firstName: string;
  country: string;
  region: string;
  line1: string;
  shippingOptionId: string;
  paymentProviderId: string;
}

export type CheckoutErrors = Partial<Record<keyof CheckoutForm, string>>;

export type { ShippingAddressInput };

/** 结账表单 → 收货地址。空值不下发，避免存一堆空串。 */
export function toShippingAddress(form: CheckoutForm): ShippingAddressInput {
  const address: ShippingAddressInput = {
    name: form.firstName.trim() || undefined,
    phone: form.phone.trim() || undefined,
    country: form.country.trim() || undefined,
    province: form.region.trim() || undefined,
    address_1: form.line1.trim() || undefined,
  };
  for (const key of Object.keys(address) as Array<keyof ShippingAddressInput>) {
    if (address[key] === undefined) delete address[key];
  }
  return address;
}

/** 结账各步表单组件共享的 props。 */
export interface StepProps {
  form: CheckoutForm;
  errors: CheckoutErrors;
  /** 可选国家（后端下发）；不传则用内置清单，mock 模式不依赖接口。 */
  countries?: Array<{ code: string; name: string }>;
  setField: <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => void;
  onBlurField: (key: keyof CheckoutForm) => void;
}

export const emptyForm: CheckoutForm = {
  phone: '',
  email: '',
  firstName: '',
  country: 'CN',
  region: '',
  line1: '',
  shippingOptionId: '',
  // 默认选中 mock 支付方式（mock 模式保持「直接能下一步」的老体验）；
  // live 模式会在支付方式列表回来后按后端实际启用的渠道校正。
  paymentProviderId: 'pp_wechat',
};

/** 配送方式（mock 常量与 live 接口统一形状，组件只认这一个）。 */
export interface ShippingOptionView {
  id: string;
  name: string;
  /** 预计时效（mock 有；live 由后端方案类型推导，可缺省）。 */
  eta?: string;
  amountMinor: number;
  currencyCode: string;
}

/** 支付方式（mock 常量与 live 接口统一形状，组件只认这一个）。 */
export interface PaymentProviderView {
  id: string;
  label: string;
  description: string;
}

/**
 * mock 模式的运费方案。
 *
 * live 模式必须走后端 listShippingOptions —— 后端按购物车小计算运费，
 * 且 setShippingMethod 只认后端真实存在的方案 id。
 */
export const SHIPPING_OPTIONS: ShippingOptionView[] = [
  { id: 'ship-standard', name: '标准跨境专线', eta: '7–12 个工作日', amountMinor: 0, currencyCode: 'CNY' },
  { id: 'ship-express', name: '优先空运', eta: '3–5 个工作日', amountMinor: 2000, currencyCode: 'CNY' },
];

/**
 * mock 模式的支付方式。
 *
 * live 模式必须走后端 listPaymentProviders —— 后端只认已启用的 provider
 * 标识（pp_alipay / pp_paypal / pp_wechat / pp_stripe），写死任何标识都收不到钱。
 */
export const PAYMENT_PROVIDERS: PaymentProviderView[] = [
  { id: 'pp_wechat', label: '微信支付', description: '将跳转至微信完成支付（当前为沙箱环境）' },
];

export const COUNTRIES = [{ code: 'CN', name: '中国' }];

/** 每步字段校验（blur 单字段 + 下一步整步共用）。 */
export function validateStep(step: number, form: CheckoutForm): CheckoutErrors {
  const errors: CheckoutErrors = {};
  if (step === 1) {
    if (!/^1[3-9]\d{9}$/.test(form.phone.trim())) errors.phone = '请输入 11 位有效手机号';
    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '邮箱格式不正确';
  }
  if (step === 2) {
    const name = form.firstName.trim();
    if (name.length < 1 || name.length > 30) errors.firstName = '收件人姓名需 1–30 个字符';
    if (!form.country) errors.country = '请选择国家 / 地区';
    if (!form.region.trim()) errors.region = '请填写省 / 市 / 区';
    const line = form.line1.trim();
    if (line.length < 5 || line.length > 200) errors.line1 = '详细地址需 5–200 个字符';
  }
  if (step === 3 && !form.paymentProviderId) errors.paymentProviderId = '请选择支付方式';
  return errors;
}

export interface OrderLineSnapshot {
  title: string;
  variantTitle?: string;
  quantity: number;
  unitPriceMinor: number;
  imageUrl?: string;
}

export type OrderStatus =
  | 'processing'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'canceled'
  | 'refund_pending'
  | 'refunded'
  | 'failed';

export interface OrderRecord {
  id: string;
  status: OrderStatus;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currencyCode: string;
  email: string;
  phone: string;
  shippingOptionName: string;
  items: OrderLineSnapshot[];
  createdAt: number;
  pollCount: number;
  failureReason?: string;
  /** 收货信息快照（订单查询详情页使用）。 */
  contactName?: string;
  shippingRegion?: string;
  shippingLine1?: string;
  /** 物流单号：后台发货时填的，顾客在订单详情看「到哪了」（ADR-033）。 */
  tracking?: { carrier: string; number: string };
  /** 支付渠道展示名（如「支付宝」）；未付款时为空。 */
  paymentMethod?: string;
}

const ORDER_PREFIX = 'order:';

function newOrderId(): string {
  return `ord_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/* ------------------------------------------------------------------ *
 * mock 模式的订单存储（live 模式走 loadLiveOrder）
 * ------------------------------------------------------------------ */

export function createOrder(input: {
  form: CheckoutForm;
  items: OrderLineSnapshot[];
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currencyCode: string;
  shippingOptionName: string;
}): OrderRecord {
  const order: OrderRecord = {
    id: newOrderId(),
    status: 'processing',
    subtotalMinor: input.subtotalMinor,
    shippingMinor: input.shippingMinor,
    taxMinor: input.taxMinor,
    totalMinor: input.totalMinor,
    currencyCode: input.currencyCode,
    email: input.form.email,
    phone: input.form.phone,
    shippingOptionName: input.shippingOptionName,
    items: input.items,
    createdAt: Date.now(),
    pollCount: 0,
    contactName: input.form.firstName,
    shippingRegion: input.form.region,
    shippingLine1: input.form.line1,
  };
  try {
    sessionStorage.setItem(ORDER_PREFIX + order.id, JSON.stringify(order));
  } catch {
    /* sessionStorage 不可用时降级为内存态 */
  }
  return order;
}

/** 幂等查询；处理中态模拟支付回调：第 2 次轮询确认成功。 */
export function getOrder(id: string): OrderRecord | null {
  try {
    const raw = sessionStorage.getItem(ORDER_PREFIX + id);
    if (!raw) return null;
    const order = JSON.parse(raw) as OrderRecord;
    if (order.status === 'processing') {
      order.pollCount += 1;
      if (order.pollCount >= 2) order.status = 'paid';
      sessionStorage.setItem(ORDER_PREFIX + id, JSON.stringify(order));
    }
    return order;
  } catch {
    return null;
  }
}

/** 只读查询（不推进轮询计数），用于沙箱强制态展示。 */
export function peekOrder(id: string): OrderRecord | null {
  try {
    const raw = sessionStorage.getItem(ORDER_PREFIX + id);
    return raw ? (JSON.parse(raw) as OrderRecord) : null;
  } catch {
    return null;
  }
}

/** 沙箱：模拟支付失败（供结果页 ?simulate=failed 演示）。 */
export function failOrder(id: string, reason: string): void {
  try {
    const raw = sessionStorage.getItem(ORDER_PREFIX + id);
    if (!raw) return;
    const order = JSON.parse(raw) as OrderRecord;
    order.status = 'failed';
    order.failureReason = reason;
    sessionStorage.setItem(ORDER_PREFIX + id, JSON.stringify(order));
  } catch {
    /* noop */
  }
}

/** 沙箱演示用合成订单（无真实下单时也能预览结果页三态）。 */
export function demoOrder(id: string): OrderRecord {
  return {
    id,
    status: 'processing',
    subtotalMinor: 19900,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 19900,
    currencyCode: 'CNY',
    email: 'guest@example.com',
    phone: '13800000000',
    shippingOptionName: '标准跨境专线',
    items: [{ title: '无线静音鼠标', variantTitle: '黑色', quantity: 1, unitPriceMinor: 19900 }],
    createdAt: Date.now(),
    pollCount: 0,
  };
}

export const CHECKOUT_STEPS = ['联系方式', '收货地址', '支付'] as const;

/* ------------------------------------------------------------------ *
 * live 模式：真实后端数据
 * ------------------------------------------------------------------ */

/** 后端错误 → 顾客能看懂的一句话。 */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return '操作失败，请稍后重试';
}

/**
 * 载入后端可用运费方案。
 *
 * country 必填（后端按国家匹配配送区）；cart_id 传当前购物车 id，
 * 后端据此按购物车小计算运费（满额免运费等规则）。
 */
export async function loadLiveShippingOptions(
  country: string,
  cartId: string | null,
): Promise<ShippingOptionView[]> {
  const res = (await getStoreClient().listShippingOptions({
    country,
    ...(cartId ? { cart_id: cartId } : {}),
  })) as { items?: ShippingOption[] };
  return (res.items ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    eta: shippingEtaOf(o.type),
    amountMinor: o.amount_minor,
    currencyCode: o.currency_code,
  }));
}

/** 后端方案类型 → 时效文案（后端不返回时效文案，前端按类型给一句人话）。 */
function shippingEtaOf(type: ShippingOption['type']): string | undefined {
  if (type === 'free_over') return '满额免运费';
  if (type === 'weight_based') return '按重量计费';
  return undefined;
}

/** 载入后端为当前渠道启用的支付方式（live 模式不许硬编码）。 */
export async function loadLivePaymentProviders(cartId: string | null): Promise<PaymentProviderView[]> {
  const res = (await getStoreClient().listPaymentProviders(cartId ?? '')) as {
    items?: PaymentProviderOption[];
  };
  return (res.items ?? []).map((p) => {
    const id = p.provider_id || p.id;
    return { id, label: p.label, description: paymentProviderHint(id) };
  });
}

/** provider 标识 → 拉起方式提示（后端只返回 id/label，形态由前端补一句人话）。 */
function paymentProviderHint(id: string): string {
  if (id === 'pp_alipay') return '将拉起支付宝扫码或收银台完成支付';
  if (id === 'pp_paypal') return '将跳转至 PayPal 收银台完成支付';
  if (id === 'pp_wechat') return '将拉起微信支付完成付款';
  if (id === 'pp_stripe') return '将拉起 Stripe 收银台完成支付';
  return '将跳转至第三方支付完成付款';
}

/** 选定配送方式（金额与方案名由后端解析，前端只传方案 id）。 */
export async function applyLiveShippingMethod(cartId: string, shippingOptionId: string): Promise<Cart> {
  return (await getStoreClient().setShippingMethod(cartId, {
    shipping_option_id: shippingOptionId,
  })) as Cart;
}

/**
 * 提交下单（走 cart-complete workflow）。
 *
 * 幂等键走 Idempotency-Key 请求头：同一个键重复提交只会产生一笔订单，
 * 所以用户连点两次「去支付」不会重复下单。幂等键按购物车固定（存在
 * sessionStorage 里），支付失败后重试也复用同一笔订单。
 */
export async function completeLiveOrder(
  cartId: string,
  idempotencyKey: string,
  shippingAddress?: ShippingAddressInput,
): Promise<Order> {
  return (
    (await getStoreClient().completeCart(
      cartId,
      idempotencyKey,
      shippingAddress ? { shipping_address: shippingAddress } : undefined,
    )) as Order
  );
}

/**
 * 创建支付会话，返回前端拉起支付所需的上下文。
 *
 * 必须在 completeLiveOrder 之后调用：后端按 cart_id 反查订单并复用
 * cart-complete workflow 建好的支付集合（带正确金额与 order_id），
 * 否则会新建一个没有 order_id 的空壳集合，支付成功后订单永远收不到 paid。
 */
export async function createLivePaymentSession(input: {
  cartId: string;
  providerId: string;
  returnUrl: string;
}): Promise<LivePaymentSession> {
  const session = (await getStoreClient().createPaymentSession({
    cart_id: input.cartId,
    provider_id: input.providerId,
    return_url: input.returnUrl,
    /*
     * 设备类型：让支付宝 provider 决定走 wap.pay（手机唤起 App）还是 page.pay（PC）。
     * 判定标准是触摸屏（pointer:coarse）而不是 UA —— UA 易被误判，触摸屏更贴近
     * 「这到底是不是手机」的本质。SSR 下 window 不可用，此时退 desktop（PC 收银台）。
     */
    ...(isTouchDevice() ? { device: 'mobile' as const } : {}),
  })) as PaymentSession;
  const context = session.context ?? {};
  return {
    sessionId: session.id,
    providerId: session.provider_id,
    kind: context.kind ?? 'clientSecret',
    qrPayload: context.qrcode ?? null,
    redirectUrl: context.redirectUrl ?? null,
    amountMinor: session.amount_minor,
    currencyCode: session.currency_code,
  };
}

/** 触摸屏判定（手机/平板）：SSR 环境无 window 时返回 false（退 PC 收银台）。 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/**
 * live 模式提交下单 + 发起支付。
 *
 * 调用顺序不能换：
 * 1. setShippingMethod —— 运费方案要落进购物车，下单时才会算进订单金额；
 * 2. completeCart —— 后端按购物车生成订单与支付集合（幂等键防重复下单）；
 * 3. createPaymentSession —— 必须传 cart_id，后端据此复用第 2 步的支付集合
 *    （带正确金额与 order_id），否则支付成功后订单永远收不到 paid。
 *
 * returnUrl 要带订单号（支付商付完跳回来时得知道看哪笔订单），而订单号
 * 在第 2 步之后才有 —— 所以这里收的是「按订单号生成回跳地址」的函数。
 */
export async function submitLiveCheckout(input: {
  cartId: string;
  providerId: string;
  returnUrlFor: (orderId: string) => string;
  idempotencyKey: string;
  /** 收货地址：订单要存下来，税率也按其中的国家解析（ADR-018）。 */
  shippingAddress?: ShippingAddressInput;
}): Promise<{ order: Order; session: LivePaymentSession }> {
  // 运费由后端按收货国家自动选并算进购物车（ADR-019），前端不再设置运费方案
  const order = await completeLiveOrder(input.cartId, input.idempotencyKey, input.shippingAddress);
  const session = await createLivePaymentSession({
    cartId: input.cartId,
    providerId: input.providerId,
    returnUrl: input.returnUrlFor(order.id),
  });
  return { order, session };
}

/**
 * 购物车内容指纹。
 *
 * 两个用途：
 * 1. 决定「复用这辆车重试」还是「换辆车出一笔新单」——
 *    后端 createPaymentSession 按 cart_id 反查订单并复用其支付集合，
 *    而 listOrders 没有 ORDER BY，一辆车若出过两单，反查结果不确定（金额会收错）。
 * 2. 拼进下单幂等键：连点两次「去支付」→ 同一个键 → 后端重放同一笔订单。
 */
export function cartFingerprint(
  lines: Array<{ id: string; quantity: number }>,
  shippingOptionId: string,
  email: string,
): string {
  const body = [...lines]
    .map((l) => `${l.id}x${l.quantity}`)
    .sort()
    .join(',');
  return `${body}|${shippingOptionId}|${email.trim()}`;
}

/**
 * 支付会话 → 前端该做什么。
 *
 * - qrcode：渲染二维码让用户扫码（支付宝当面付），钱由支付商异步回调后端；
 * - redirectUrl：整页跳转到支付商收银台（PayPal）；
 * - clientSecret：前端 SDK 场景，本项目用不到。
 */
export type PaymentLaunch =
  | { type: 'qrcode'; qrPayload: string }
  | { type: 'redirect'; url: string }
  | { type: 'unsupported'; message: string };

export function resolvePaymentLaunch(session: LivePaymentSession): PaymentLaunch {
  if (session.kind === 'qrcode' && session.qrPayload) {
    return { type: 'qrcode', qrPayload: session.qrPayload };
  }
  if (session.kind === 'redirectUrl' && session.redirectUrl) {
    return { type: 'redirect', url: session.redirectUrl };
  }
  return { type: 'unsupported', message: '该支付方式暂不支持，请选择其他支付方式' };
}

/** 支付会话的拉起形态：决定前端怎么把用户送进支付环节。 */
export type LivePaymentKind = 'qrcode' | 'redirectUrl' | 'clientSecret';

export interface LivePaymentSession {
  sessionId: string;
  providerId: string;
  kind: LivePaymentKind;
  /** kind = qrcode 时：待渲染成二维码的字符串（支付宝当面付为 qr.alipay.com 链接）。 */
  qrPayload: string | null;
  /** kind = redirectUrl 时：支付商收银台地址。 */
  redirectUrl: string | null;
  amountMinor: number;
  currencyCode: string;
}

/** live 订单 → 统一展示模型（结果页三态与 mock 共用一套渲染）。 */
export function toOrderRecord(order: Order): OrderRecord {
  /*
   * 按订单原始状态映射，不要「只要付过款就一律 paid」——
   * 那样已发货、已退款、退款中在店面全显示成「待发货」，顾客会以为还能改地址。
   */
  const status: OrderStatus =
    order.status === 'refund_pending'
      ? 'refund_pending'
      : order.status === 'refunded' || order.payment_status === 'refunded'
        ? 'refunded'
        : order.status === 'canceled'
          ? 'failed'
          : order.status === 'completed' || order.status === 'delivered'
            ? 'delivered'
            : order.status === 'fulfilled' || order.status === 'partially_fulfilled'
              ? 'shipped'
              : order.status === 'paid' || order.payment_status === 'captured'
                ? 'paid'
                : 'processing';
  const address = order.shipping_address;
  return {
    id: order.id,
    status,
    subtotalMinor: order.subtotal_minor,
    shippingMinor: order.shipping_minor,
    taxMinor: order.tax_minor,
    totalMinor: order.total_minor,
    currencyCode: order.currency_code,
    email: order.email,
    phone: address?.phone ?? '',
    shippingOptionName: order.shipping_method?.name ?? '',
    items: (order.line_items ?? []).map((li) => ({
      title: li.title,
      quantity: li.quantity,
      unitPriceMinor: li.unit_price_minor,
    })),
    createdAt: order.placed_at ? Date.parse(order.placed_at) : Date.now(),
    pollCount: 0,
    // 物流：取第一张有单号的发货单。拆包分批发时，顾客先看到第一个包裹
    ...mapTracking(order),
    // 支付渠道用后端给的 label，不写死渠道：写死「微信支付」会让 PayPal 订单也显示微信
    paymentMethod: order.payment_provider?.label,
    ...(address
      ? {
          contactName: [address.first_name, address.last_name].filter(Boolean).join(' '),
          shippingRegion: address.city,
          shippingLine1: address.line1,
        }
      : {}),
    ...(status === 'failed' ? { failureReason: '订单未完成支付，请重新支付' } : {}),
  };
}

/** 查询 live 订单（结果页轮询用）。查不到返回 null。 */
/** 从订单的发货单里取一条物流单号（没有就返回空对象，不塞 undefined 字段）。 */
function mapTracking(order: Order): { tracking?: { carrier: string; number: string } } {
  for (const f of order.fulfillments ?? []) {
    const link = f.tracking_links?.find((l) => l.number);
    if (link) return { tracking: { carrier: link.carrier, number: link.number } };
  }
  return {};
}

export async function loadLiveOrder(orderId: string): Promise<OrderRecord | null> {
  try {
    const order = (await getStoreClient().getOrder(orderId)) as Order;
    return toOrderRecord(order);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * live 模式：待支付会话（跨页面传递二维码与金额）
 * ------------------------------------------------------------------ */

export interface PendingPayment {
  orderId: string;
  /** kind = qrcode 时的二维码内容。 */
  qrPayload: string | null;
  amountMinor: number;
  currencyCode: string;
  providerId: string;
  providerLabel: string;
  kind: LivePaymentKind;
}

const PENDING_PAYMENT_PREFIX = 'checkout:pay:';

/** 存下待支付会话（支付页要靠它渲染二维码与金额）。 */
export function savePendingPayment(payment: PendingPayment): void {
  try {
    sessionStorage.setItem(PENDING_PAYMENT_PREFIX + payment.orderId, JSON.stringify(payment));
  } catch {
    /* sessionStorage 不可用时降级为内存态 */
  }
}

/** 读取待支付会话；缺失返回 null（刷新丢数据时支付页据此提示重新下单）。 */
export function readPendingPayment(orderId: string): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PAYMENT_PREFIX + orderId);
    return raw ? (JSON.parse(raw) as PendingPayment) : null;
  } catch {
    return null;
  }
}
