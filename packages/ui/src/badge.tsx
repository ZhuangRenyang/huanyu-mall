import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

/**
 * 徽章变体表（shadcn 形态：cva 声明变体，cn 合并 className）。
 * 语义与 design-tokens 一一对应：brand=品牌淡底、promo=促销橙、其余走状态色。
 */
export const badgeVariants = cva('inline-flex items-center rounded-xs px-1 text-xs font-medium leading-5', {
  variants: {
    variant: {
      neutral: 'bg-muted text-muted-foreground',
      brand: 'bg-primary-subtle text-primary-subtle-foreground',
      promo: 'bg-accent-orange text-accent-orange-foreground',
      success: 'bg-success-subtle text-success',
      warning: 'bg-warning-subtle text-warning',
      info: 'bg-info-subtle text-info',
      destructive: 'bg-destructive-subtle text-destructive',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
