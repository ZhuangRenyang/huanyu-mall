'use client';

import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

/**
 * 纯图标按钮变体表（shadcn 形态）。
 *
 * 触摸区（WCAG 2.5.5 ≥44×44）：
 *   md = size-11 (44×44) —— 默认档，所有主要图标操作都用它
 *   lg = size-12 (48×48) —— 大号/移动端主操作
 *   sm = size-9  (36×36) —— 仅用于列表行内的次级操作（删除/更多），始终带 aria-label
 *                          ⚠️ sm 视觉尺寸小于 44，这是既有设计取值；如需全部达 44
 *                          需设计侧确认（info-density 会变），本组件不擅自改尺寸。
 */
export const iconButtonVariants = cva(
  [
    'grid place-items-center rounded-md text-muted-foreground',
    'transition-colors duration-150 hover:bg-muted hover:text-foreground',
  ],
  {
    variants: {
      size: {
        sm: 'size-9',
        md: 'size-11',
        lg: 'size-12',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type IconButtonSize = NonNullable<VariantProps<typeof iconButtonVariants>['size']>;

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size, type = 'button', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(iconButtonVariants({ size }), className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);
IconButton.displayName = 'IconButton';
