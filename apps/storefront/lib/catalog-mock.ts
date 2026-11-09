/**
 * mock 商品目录（仅 mock 模式使用）。
 * 独立成文件 + 动态 import：live 模式不会加载，避免假数据进首屏 bundle。
 */
import type {
  AttributeGroup,
  CatalogImage,
  CatalogProduct,
  CatalogVariant,
  MockCategory,
  StoreProduct,
} from './catalog';

const CNY = 'CNY';

export const mockCategories: MockCategory[] = [
  { id: 'cat-peripherals', name: '外设', handle: 'peripherals' },
  { id: 'cat-audio', name: '音频', handle: 'audio' },
  { id: 'cat-accessories', name: '配件', handle: 'accessories' },
  { id: 'cat-lighting', name: '照明', handle: 'lighting' },
];

export const attributeGroups: AttributeGroup[] = [{ name: '连接方式', values: ['无线', '有线'] }];

function imgs(seed: string): CatalogImage[] {
  return [0, 1].map((i) => ({
    id: `${seed}-${i}`,
    url: `https://picsum.photos/seed/${seed}${i ? '-' + i : ''}/800/1000`,
    alt: '',
  }));
}

function variant(
  id: string,
  title: string,
  optName: string,
  optVal: string,
  priceMinor: number,
  stock: number,
  originalMinor?: number,
): CatalogVariant {
  return { id, title, options: { [optName]: optVal }, priceMinor, stock, originalMinor };
}

export const catalogProducts: CatalogProduct[] = [
  {
    id: 'prod_mouse',
    title: '无线静音鼠标',
    handle: 'wireless-mouse',
    subtitle: '静音按键 · 三档 DPI',
    description:
      '2.4G 与蓝牙双模连接，静音微动点击声低于 30dB，适合共享办公与夜间使用。三档 DPI 一键切换，单节电池续航约 6 个月。',
    categoryId: 'cat-peripherals',
    createdAt: '2026-09-12',
    images: imgs('mouse'),
    attributes: [{ name: '连接方式', value: '无线' }],
    variants: [variant('var_mouse_black', '黑色', '颜色', '黑色', 19900, 8), variant('var_mouse_white', '白色', '颜色', '白色', 19900, 0)],
  },
  {
    id: 'prod_keyboard',
    title: '87 键机械键盘',
    handle: 'mechanical-keyboard',
    subtitle: '热插拔 · 全键无冲',
    description:
      '87 键紧凑布局，支持热插拔轴体与全键无冲。PBT 键帽耐磨不易打油，三向出线槽适配多种桌面走线，兼顾游戏与长时间打字。',
    categoryId: 'cat-peripherals',
    createdAt: '2026-10-02',
    badge: '促销',
    originalMinor: 59900,
    images: imgs('keyboard'),
    attributes: [{ name: '连接方式', value: '有线' }],
    variants: [
      variant('var_kb_red', '红轴', '轴体', '红轴', 49900, 5, 59900),
      variant('var_kb_brown', '茶轴', '轴体', '茶轴', 52900, 3, 59900),
      variant('var_kb_blue', '青轴', '轴体', '青轴', 52900, 0, 59900),
    ],
  },
  {
    id: 'prod_headphones',
    title: '主动降噪头戴耳机',
    handle: 'anc-headphones',
    subtitle: '40 小时续航 · 蓝牙 5.4',
    description:
      '混合主动降噪最高降噪 42dB，40 小时超长续航，支持多点连接与低延迟游戏模式。蛋白皮耳罩久戴不闷，适合通勤与差旅。',
    categoryId: 'cat-audio',
    createdAt: '2026-10-20',
    images: imgs('headphones'),
    attributes: [{ name: '连接方式', value: '无线' }],
    variants: [variant('var_hp_black', '曜石黑', '颜色', '曜石黑', 89900, 12), variant('var_hp_white', '云母白', '颜色', '云母白', 89900, 4)],
  },
  {
    id: 'prod_dock',
    title: '6 合 1 USB-C 扩展坞',
    handle: 'usb-c-dock',
    subtitle: 'HDMI 4K · 100W PD',
    description:
      '一个接口扩展 HDMI 4K@60Hz、千兆网口、SD/TF 读卡与两个 USB 3.0，同时支持 100W PD 反向充电，笔记本一线连齐桌面外设。',
    categoryId: 'cat-accessories',
    createdAt: '2026-08-30',
    images: imgs('dock'),
    attributes: [{ name: '连接方式', value: '有线' }],
    variants: [variant('var_dock_6', '6 合 1', '接口', '6 合 1', 25900, 20), variant('var_dock_8', '8 合 1', '接口', '8 合 1', 34900, 6)],
  },
  {
    id: 'prod_powerbank',
    title: '20000mAh 快充充电宝',
    handle: 'fast-charge-powerbank',
    subtitle: '双向 65W · 数显电量',
    description:
      '20000mAh 大容量，单口最高 65W 双向快充，可同时为笔记本与手机供电。数显剩余电量，符合民航随身携带标准。',
    categoryId: 'cat-accessories',
    createdAt: '2026-10-11',
    badge: '促销',
    originalMinor: 19900,
    images: imgs('powerbank'),
    attributes: [{ name: '连接方式', value: '无线' }],
    variants: [variant('var_pb_gray', '深空灰', '颜色', '深空灰', 14900, 0, 19900), variant('var_pb_blue', '远峰蓝', '颜色', '远峰蓝', 14900, 15, 19900)],
  },
  {
    id: 'prod_stand',
    title: '铝合金显示器支架',
    handle: 'monitor-stand',
    subtitle: '承重 8kg · 自由升降',
    description:
      '铝合金气压臂，单臂承重 8kg，支持升降、俯仰与旋转，轻松在横竖屏间切换。夹桌式安装免打孔，适配 17–32 英寸显示器。',
    categoryId: 'cat-accessories',
    createdAt: '2026-07-18',
    images: imgs('stand'),
    attributes: [{ name: '连接方式', value: '有线' }],
    variants: [variant('var_stand_single', '单臂', '尺寸', '单臂', 32900, 9), variant('var_stand_dual', '双臂', '尺寸', '双臂', 42900, 2)],
  },
  {
    id: 'prod_gimbal',
    title: '三轴手机云台稳定器',
    handle: 'phone-gimbal',
    subtitle: '磁吸快拆 · 智能跟拍',
    description:
      '三轴增稳抵消手抖，磁吸快拆手机夹秒装秒卸。内置智能跟拍与多种运镜模板，Vlog 与直播一键出片。',
    categoryId: 'cat-accessories',
    createdAt: '2026-11-01',
    images: imgs('gimbal'),
    attributes: [{ name: '连接方式', value: '无线' }],
    variants: [variant('var_gimbal_black', '石墨黑', '颜色', '石墨黑', 59900, 7)],
  },
  {
    id: 'prod_lamp',
    title: '桌面护眼 LED 台灯',
    handle: 'desk-led-lamp',
    subtitle: '无频闪 · 三色温',
    description:
      '无频闪恒流驱动，三色温无级调光，照度均匀减少用眼疲劳。触控调光 + 定时休息提醒，适合长时间阅读与办公。',
    categoryId: 'cat-lighting',
    createdAt: '2026-09-25',
    images: imgs('lamp'),
    attributes: [{ name: '连接方式', value: '有线' }],
    variants: [variant('var_lamp_warm', '暖光', '色温', '暖光', 12900, 10), variant('var_lamp_cool', '冷光', '色温', '冷光', 12900, 3)],
  },
];

function toStoreProduct(p: CatalogProduct): StoreProduct {
  const minPrice = Math.min(...p.variants.map((v) => v.priceMinor));
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    subtitle: p.subtitle,
    thumbnail_url: p.images[0]?.url ?? null,
    status: 'published',
    price: { amount_minor: minPrice, currency_code: CNY },
    originalMinor: p.originalMinor,
    badge: p.badge,
    categoryId: p.categoryId,
    createdAt: p.createdAt,
    attributes: p.attributes,
  };
}

export const mockProducts: StoreProduct[] = catalogProducts.map(toStoreProduct);

export function getProductByHandle(handle: string): CatalogProduct | undefined {
  return catalogProducts.find((p) => p.handle === handle);
}
