import { cn } from './lib/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 覆盖默认 aspect，或给宽高（如 h-4 w-24）。 */
  className?: string;
}

/**
 * 骨架块。
 *
 * 视觉由 design-tokens 的 `.skeleton` 类承载，不在这里叠加 `bg-muted rounded-md`：
 * - `.skeleton` 用 `--skeleton-base` 作底色、从 `--radius` 派生圆角、动画为
 *   `skeleton-pulse 1600ms` + `--skeleton-delay: 300ms` 延迟（快速加载时不闪骨架屏）；
 * - 若再叠加 `bg-muted` / `rounded-md`，背景与圆角会与 `.skeleton` 重复，而
 *   tailwind-merge 无法把自定义类与工具类归入同组，最终胜负由 CSS 层叠顺序决定 ——
 *   不可控。shadcn 原版用 `animate-pulse` 是因为它没有 token 化的自定义骨架类，
 *   我们已有更完整的实现，不做降级替换。
 *
 * 组件形态对齐 shadcn：`data-slot` + 展开原生属性 + 默认 `aria-hidden`（骨架屏对
 * 屏幕阅读器无意义，允许调用方显式覆盖）。
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div data-slot="skeleton" className={cn('skeleton', className)} aria-hidden="true" {...props} />
  );
}

/** 商品卡骨架：4:5 图 + 两行标题 + 价格行，与真实卡同高。 */
export function ProductCardSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="aspect-product w-full rounded-lg" />
      <Skeleton className="h-4 w-4/5 rounded-sm" />
      <Skeleton className="h-4 w-3/5 rounded-sm" />
      <Skeleton className="h-4 w-1/3 rounded-sm" />
    </div>
  );
}
