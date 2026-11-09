/**
 * className 合并 —— shadcn/ui 标准实现（clsx + tailwind-merge）。
 *
 * clsx：条件拼接（false/null/undefined 自动丢弃）。
 * tailwind-merge：**同类冲突只留最后一个**（`cn('px-2','px-4')` → `px-4`），
 * 这样组件「变体默认类 + 调用方 className」叠加时不会出现两个背景色/两个内边距。
 */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * 品牌语义色（来自 @mall/design-tokens 的 @theme 映射）。
 *
 * 实测结论（tailwind-merge 3.7.0）：这些名字默认已能正确归入 bg/text/border 等
 * 颜色分组并消解冲突（通用色校验器并未把我们挡在外面），所以这里是**显式登记**而
 * 非救火：
 * 1. 自文档化 —— 一眼看出哪些是品牌 token，不是拼错的 Tailwind 内置色；
 * 2. 防回退 —— 将来 tailwind-merge 收紧校验器时，登记过的名字不会突然失效。
 * 已用探针验证：登记前后 `bg-red-500 + bg-primary`、`bg-neutral-900/40 + bg-card`
 * 等组合结果完全一致，不存在「收窄成白名单后标准色不再消解」的回归。
 */
const BRAND_COLORS = [
  // 表面 / 文本
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  // 品牌主色（含 hover/active/subtle 三档派生）
  'primary',
  'primary-foreground',
  'primary-hover',
  'primary-active',
  'primary-subtle',
  'primary-subtle-foreground',
  // 次级 / 弱化 / hover 面（shadcn 语义：accent = hover 面，不是品牌色）
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  // 强调橙（促销价 / 高亮）
  'accent-orange',
  'accent-orange-foreground',
  'accent-orange-deep',
  'accent-orange-subtle',
  'accent-orange-subtle-foreground',
  // 语义状态
  'destructive',
  'destructive-foreground',
  'destructive-subtle',
  'success',
  'success-foreground',
  'success-subtle',
  'warning',
  'warning-foreground',
  'warning-subtle',
  'info',
  'info-foreground',
  'info-subtle',
  // 线与控件
  'border',
  'border-strong',
  'input',
  'ring',
  // 后台侧边栏
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
];

/**
 * 商品图比例工具类（--aspect-product / --aspect-wide）。
 * 这两个是**真缺口**：tailwind-merge 的 aspect 分组内置只有 auto/square/video + 分数，
 * 不登记的话 `cn('aspect-product', 'aspect-square')` 会两个都留下 —— 已用探针复现并修复。
 */
const ASPECT_TOKENS = ['product', 'wide'];

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: BRAND_COLORS,
      aspect: ASPECT_TOKENS,
    },
  },
});

export type { ClassValue };

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
