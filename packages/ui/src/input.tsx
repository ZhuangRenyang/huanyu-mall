'use client';

import * as React from 'react';
import { cn } from './lib/cn';

/**
 * 单行输入框（shadcn/ui Input 形态）。
 *
 * 高度 h-9 与 `Select` 的触发器对齐，保证表单里输入框与下拉框视觉齐平。
 * `aria-invalid` 由调用方（或表单库）设置，这里只负责把它映射成错误边框 ——
 * 这样错误态的来源是**无障碍属性**而不是另加一个 error prop，屏幕阅读器与视觉同步。
 */
function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
        'outline-none transition-colors duration-150 placeholder:text-muted-foreground',
        'focus:border-ring focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
