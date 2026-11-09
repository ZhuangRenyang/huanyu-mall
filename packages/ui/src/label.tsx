'use client';

import * as React from 'react';
import { cn } from './lib/cn';

/**
 * 表单标签（shadcn/ui Label 形态）。
 *
 * 不引 `@radix-ui/react-label`：原生 `<label>` 已具备 `htmlFor` 关联与点击聚焦，
 * Radix 那一层的价值主要在「点击文本聚焦到目标控件」的边缘情况，
 * 为本项目省一个依赖。若将来接入表单库需要它的 `onMouseDown` 防重复触发行为，
 * 再单独引入即可。
 *
 * 默认不带外边距：间距由调用方（如 admin 的 Field 容器）控制，
 * 避免组件内写死间距后与不同布局打架。
 */
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'block text-sm font-medium text-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
