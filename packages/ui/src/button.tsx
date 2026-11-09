'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

/**
 * 按钮变体表（shadcn 形态：cva 声明变体，cn 合并 className）。
 *
 * 尺寸是设计规范硬指标，**不可改**：
 *   sm = h-8  (32px)
 *   md = h-11 (44px，移动端触摸下限)
 *   lg = h-13 (52px，结账主 CTA)
 */
export const buttonVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-2 rounded-md font-medium',
    'transition-colors duration-150',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        ghost: 'bg-transparent text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'h-8 px-4 text-sm', // 32px
        md: 'h-11 px-4 text-sm', // 44px，满足移动端触摸下限
        lg: 'h-13 px-6 text-base', // 52px，结账主 CTA
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 进入 loading：显示 Loader2 旋转并禁用点击，文案自行替换。 */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading && <Loader2 className="size-5 animate-spin" strokeWidth={2} aria-hidden="true" />}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
