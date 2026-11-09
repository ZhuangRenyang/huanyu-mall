'use client';

import * as React from 'react';
import { cn } from './lib/cn';

/**
 * 多行输入框（shadcn/ui Textarea 形态）。
 *
 * 默认 `rows=3` 并给 `min-h` 兜底，避免 rows 被样式覆盖后塌成一行。
 * 其余（`aria-invalid` → 错误边框、focus ring）与 `Input` 保持一致。
 */
function Textarea({ className, rows = 3, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={rows}
      data-slot="textarea"
      className={cn(
        'min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground',
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

export { Textarea };
