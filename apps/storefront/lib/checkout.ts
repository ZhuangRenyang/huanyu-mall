/**
 * 结账与支付结果的数据/逻辑层（一期 mock，接真实 API 后替换为 SDK 调用）。
 * 订单记录存 sessionStorage，保证结果页「可重入」：刷新后按 order id 查询不丢状态。
 */

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

/** 结账各步表单组件共享的 props。 */
export interface StepProps {
  form: CheckoutForm;
  errors: CheckoutErrors;
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
  paymentProviderId: 'wechat',
};

export interface ShippingOptionMock {
  id: string;
  name: string;
  eta: string;
  amountMinor: number;
}

export const SHIPPING_OPTIONS: ShippingOptionMock[] = [
  { id: 'ship-standard', name: '标准跨境专线', eta: '7–12 个工作日', amountMinor: 0 },
  { id: 'ship-express', name: '优先空运', eta: '3–5 个工作日', amountMinor: 2000 },
];

export interface PaymentProviderMock {
  id: string;
  providerId: string;
  label: string;
  description: string;
}

export const PAYMENT_PROVIDERS: PaymentProviderMock[] = [
  { id: 'wechat', providerId: 'wechat', label: '微信支付', description: '将跳转至微信完成支付（当前为沙箱环境）' },
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
  if (step === 3 && !form.shippingOptionId) errors.shippingOptionId = '请选择配送方式';
  if (step === 4 && !form.paymentProviderId) errors.paymentProviderId = '请选择支付方式';
  return errors;
}

export interface OrderLineSnapshot {
  title: string;
  variantTitle?: string;
  quantity: number;
  unitPriceMinor: number;
  imageUrl?: string;
}

export type OrderStatus = 'processing' | 'paid' | 'failed';

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
}

const ORDER_PREFIX = 'order:';

function newOrderId(): string {
  return `ord_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

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

export const CHECKOUT_STEPS = ['联系方式', '收货地址', '配送方式', '支付'] as const;
