/**
 * 后台 mock 数据与类型（Admin API 后端在建，先本地 mock）。
 * 主题预设色板为「可配置品牌色数据」（同 design-tokens 的 primitive 语义），
 * 非组件样式硬编码；组件一律通过 preset id / CSS 变量引用。
 */

export type ProductStatus = 'published' | 'draft';

export interface VariantDraft {
  id: string;
  sku: string;
  title: string;
  priceMinor: number; // CNY
  stock: number;
}

export interface ProductDraft {
  id: string;
  title: string;
  handle: string;
  subtitle?: string;
  status: ProductStatus;
  variants: VariantDraft[];
  createdAt: string;
}

export type OrderPayment = 'paid' | 'pending' | 'refunded';
export type OrderFulfillment = 'unfulfilled' | 'partial' | 'shipped' | 'delivered';

export interface AdminOrderLine {
  /** 后端行项 id：按仓发货时必须回传给 CreateFulfillment（mock 数据没有）。 */
  id?: string;
  title: string;
  variantTitle?: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface AdminOrder {
  id: string;
  customerName: string;
  customerEmail: string;
  createdAt: string;
  paymentStatus: OrderPayment;
  fulfillmentStatus: OrderFulfillment;
  currency: string;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  items: AdminOrderLine[];
  shippingAddress: string;
  carrier?: string;
  trackingNumber?: string;
}

export interface ThemeConfig {
  primaryColor: string; // preset id
  fontPreset: string;
  radius: number;
  shadow: 'none' | 'light' | 'medium';
  productRatio: '1:1' | '4:5' | '3:4';
  announcement: string;
}

export interface ProviderConfig {
  id: string;
  label: string;
  enabled: boolean;
  secretKey: string;
}

export interface AdminSession {
  email: string;
  name: string;
  role: 'admin' | 'staff';
}

/** 主题预设色板（可配置品牌色，数据层）。 */
export const THEME_PRESETS = [
  { id: 'blue', name: '活力蓝', value: '#1666D9' },
  { id: 'green', name: '墨绿', value: '#0F766E' },
  { id: 'navy', name: '藏蓝', value: '#1E3A5F' },
  { id: 'brick', name: '砖红', value: '#B4442E' },
  { id: 'olive', name: '橄榄', value: '#5E6B3B' },
  { id: 'brown', name: '深棕', value: '#6B4A34' },
  { id: 'graphite', name: '石墨', value: '#3A3A42' },
  { id: 'sand', name: '砂岩', value: '#A8875F' },
] as const;

export const FONT_PRESETS = [
  { id: 'archivo', name: 'Archivo + 思源黑体', stack: '"Archivo", "Noto Sans SC", sans-serif' },
  { id: 'inter', name: 'Inter + 苹方', stack: '"Inter", "PingFang SC", sans-serif' },
  { id: 'georgia', name: 'Georgia + 宋体', stack: 'Georgia, "Songti SC", serif' },
] as const;

export const DEFAULT_THEME: ThemeConfig = {
  primaryColor: 'blue',
  fontPreset: 'archivo',
  radius: 8,
  shadow: 'light',
  productRatio: '4:5',
  announcement: '',
};

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'wechat', label: '微信支付', enabled: true, secretKey: '' },
  { id: 'alipay', label: '支付宝', enabled: false, secretKey: '' },
  { id: 'stripe', label: 'Stripe', enabled: false, secretKey: '' },
  { id: 'paypal', label: 'PayPal', enabled: false, secretKey: '' },
];

export const SEED_PRODUCTS: ProductDraft[] = [
  {
    id: 'p1',
    title: '无线静音鼠标',
    handle: 'wireless-mouse',
    subtitle: '静音按键 · 三档 DPI',
    status: 'published',
    createdAt: '2026-09-12',
    variants: [
      { id: 'v1', sku: 'MS-BLK', title: '黑色', priceMinor: 19900, stock: 8 },
      { id: 'v2', sku: 'MS-WHT', title: '白色', priceMinor: 19900, stock: 0 },
    ],
  },
  {
    id: 'p2',
    title: '87 键机械键盘',
    handle: 'mechanical-keyboard',
    subtitle: '热插拔 · 全键无冲',
    status: 'published',
    createdAt: '2026-10-02',
    variants: [
      { id: 'v3', sku: 'KB-RED', title: '红轴', priceMinor: 49900, stock: 5 },
      { id: 'v4', sku: 'KB-BROWN', title: '茶轴', priceMinor: 52900, stock: 3 },
    ],
  },
  {
    id: 'p3',
    title: '主动降噪头戴耳机',
    handle: 'anc-headphones',
    status: 'published',
    createdAt: '2026-10-20',
    variants: [{ id: 'v5', sku: 'HP-BLK', title: '曜石黑', priceMinor: 89900, stock: 12 }],
  },
  {
    id: 'p4',
    title: '6 合 1 USB-C 扩展坞',
    handle: 'usb-c-dock',
    status: 'draft',
    createdAt: '2026-08-30',
    variants: [{ id: 'v6', sku: 'DOCK-6', title: '6 合 1', priceMinor: 25900, stock: 20 }],
  },
];

export const SEED_ORDERS: AdminOrder[] = [
  {
    id: 'ord_2401',
    customerName: '林知远',
    customerEmail: 'lin@example.com',
    createdAt: '2026-11-06 12:20',
    paymentStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    currency: 'CNY',
    subtotalMinor: 89900,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 89900,
    items: [{ title: '主动降噪头戴耳机', variantTitle: '曜石黑', quantity: 1, unitPriceMinor: 89900 }],
    shippingAddress: '广东省深圳市南山区 科技园科苑路 15 号',
  },
  {
    id: 'ord_2402',
    customerName: '陈苇',
    customerEmail: 'chen@example.com',
    createdAt: '2026-11-05 09:10',
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    currency: 'CNY',
    subtotalMinor: 52900,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 52900,
    items: [{ title: '87 键机械键盘', variantTitle: '茶轴', quantity: 1, unitPriceMinor: 52900 }],
    shippingAddress: '上海市浦东新区 张江高科祖冲之路 88 号',
    carrier: '顺丰国际',
    trackingNumber: 'SF1234567890',
  },
  {
    id: 'ord_2403',
    customerName: '赵一鸣',
    customerEmail: 'zhao@example.com',
    createdAt: '2026-11-04 18:40',
    paymentStatus: 'pending',
    fulfillmentStatus: 'unfulfilled',
    currency: 'CNY',
    subtotalMinor: 14900,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 14900,
    items: [{ title: '20000mAh 快充充电宝', variantTitle: '远峰蓝', quantity: 1, unitPriceMinor: 14900 }],
    shippingAddress: '北京市海淀区 中关村大街 1 号',
  },
  {
    id: 'ord_2404',
    customerName: '苏明明',
    customerEmail: 'su@example.com',
    createdAt: '2026-11-02 15:05',
    paymentStatus: 'refunded',
    fulfillmentStatus: 'delivered',
    currency: 'CNY',
    subtotalMinor: 32900,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 32900,
    items: [{ title: '铝合金显示器支架', variantTitle: '单臂', quantity: 1, unitPriceMinor: 32900 }],
    shippingAddress: '浙江省杭州市西湖区 文三路 100 号',
    carrier: 'DHL',
    trackingNumber: 'DH9876543210',
  },
  {
    /* 跨仓演示单：两个商品行 → mock 预留分别落在主仓与备用仓，用于演示「按仓发货」。 */
    id: 'ord_2405',
    customerName: '周予安',
    customerEmail: 'zhou@example.com',
    createdAt: '2026-11-06 15:30',
    paymentStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    currency: 'CNY',
    subtotalMinor: 69800,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 69800,
    items: [
      { title: '无线静音鼠标', variantTitle: 'MS-BLK', quantity: 1, unitPriceMinor: 19900 },
      { title: '87 键机械键盘', variantTitle: 'KB-RED', quantity: 1, unitPriceMinor: 49900 },
    ],
    shippingAddress: '江苏省南京市鼓楼区 中山北路 100 号',
  },
];
