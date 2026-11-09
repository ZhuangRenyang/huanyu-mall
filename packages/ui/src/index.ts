/**
 * @mall/ui — shadcn/ui 风格原子组件 + M18 可嵌入组件。
 * 只接 props（数据 + 回调），不 import apps/storefront，不持全局状态。
 */
export * from './button';
export * from './icon-button';
export * from './badge';
export * from './price';
export * from './skeleton';
export * from './quantity-stepper';
export * from './empty-state';
export * from './cart-drawer';
export * from './product-gallery';
export * from './variant-picker';
export * from './types';
/* shadcn/ui 实现体系：交互与表单原子（基于 Radix 原语，无障碍由 Radix 提供） */
export * from './dialog';
export * from './sheet';
export * from './tabs';
export * from './select';
export * from './input';
export * from './textarea';
export * from './label';
export * from './toast';
export { cn } from './lib/cn';
/**
 * 金额只导出「最小单位 → 可读字符串」这一个入口（formatMoney）。
 * 换算到主单位的两个内部工具函数**故意不导出**：导出即公开 API，会诱导 UI 层
 * 自己拿主单位做金额运算，而 UIUX 规范明确禁止（业务换算在 core/money）。
 * 实现仍保留在 lib/format.ts 内，仅由 formatMoney 调用。
 */
export { formatMoney } from './lib/format';
export type { MinorAmount } from './lib/format';
