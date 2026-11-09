'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from './lib/cn';

/**
 * 侧边抽屉（shadcn/ui Sheet 形态，与 Dialog 同源）。
 *
 * 与 Dialog 的差别只有定位与进出方向：`side` 决定贴哪一边、从哪个方向滑入。
 * 无障碍能力同样由 Radix 提供（焦点陷阱 / Escape / 焦点归还 / 滚动锁定），不重写。
 *
 * 台面用途：后台的集中任务面板、店面的购物车抽屉 —— 两者共用这一份实现，
 * 避免"后台一套 Modal、前台一套 Drawer"的重复。
 */
const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-4 bg-card text-card-foreground shadow-lg transition ease-in-out',
  {
    variants: {
      side: {
        right: 'inset-y-0 right-0 h-full w-full max-w-xl border-l border-border',
        left: 'inset-y-0 left-0 h-full w-full max-w-xl border-r border-border',
        top: 'inset-x-0 top-0 h-auto max-h-[80vh] border-b border-border',
        bottom: 'inset-x-0 bottom-0 h-auto max-h-[80vh] rounded-t-xl border-t border-border',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

function Sheet(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('fixed inset-0 z-50 bg-neutral-900/40', className)}
      {...props}
    />
  );
}

export interface SheetContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** 是否显示右上角关闭按钮，默认显示。 */
  showCloseButton?: boolean;
}

function SheetContent({ className, children, side, showCloseButton = true, ...props }: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        /* 同 dialog.tsx：Radix 不设 aria-modal，这里显式声明（调用方可用 props 覆盖） */
        aria-modal="true"
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sheet-close-button"
            className={cn(
              'absolute top-4 right-4 rounded-sm text-muted-foreground opacity-70 transition-opacity',
              'hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              'disabled:pointer-events-none',
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('shrink-0 border-b border-border px-5 py-3 pr-12', className)}
      {...props}
    />
  );
}

/** 抽屉主体：占满剩余高度并可滚动，内边距由这里统一给（Header/Footer 各自带边框与内边距）。 */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-body" className={cn('flex-1 overflow-y-auto p-5', className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('shrink-0 border-t border-border p-4', 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  sheetVariants,
};
