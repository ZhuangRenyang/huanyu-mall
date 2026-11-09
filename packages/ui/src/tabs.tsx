'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './lib/cn';

/**
 * 标签页（shadcn/ui Tabs 形态，基于 Radix 原语）。
 *
 * 无障碍由 Radix 提供：`role="tablist"/"tab"/"tabpanel"`、方向键切换、
 * `aria-selected`、`aria-controls`、不可用项的 `aria-disabled`。不重写。
 *
 * 视觉沿用项目既有的「下划线选中态」：选中项 `border-primary text-primary`，
 * 未选中 `border-transparent text-muted-foreground` —— 与迁移前后台手写 tab 的
 * 外观保持一致（视觉回归要求差异为 0）。
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors duration-150',
        'border-transparent text-muted-foreground hover:text-foreground',
        'data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-primary',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('focus-visible:outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
