'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './lib/cn';

/**
 * 对话框（shadcn/ui Dialog 形态，基于 Radix 原语）。
 *
 * 无障碍能力全部由 Radix 提供，**不要在这里重写**：
 * 焦点陷阱、Escape 关闭、打开时焦点移入、关闭后焦点归还触发元素、
 * 背景滚动锁定、`role="dialog"` + `aria-modal="true"`。
 * 标题/描述请用 `DialogTitle` / `DialogDescription`，Radix 会自动生成
 * `aria-labelledby` / `aria-describedby` 关联。
 *
 * 配色：遮罩用 `bg-neutral-900/40`（中性色阶 token 派生，与迁移前 admin 的弹窗
 * 遮罩浓度一致）；弹层底色走 `bg-card` / `text-card-foreground` 语义对，
 * 换肤只改 design-tokens，组件零改动。层级用 `--z-modal` 令牌，不自造 z-index。
 */
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-[var(--z-modal)] bg-neutral-900/40', className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        /*
         * Radix 的 Dialog 不设置 aria-modal —— 它用「焦点陷阱 + 给背景内容加 aria-hidden」
         * 实现模态语义。但 aria-modal="true" 是 ARIA 1.1 里更明确的信号（告诉辅助技术
         * 只关注本 dialog、忽略其余内容），两者叠加不冲突，且显式声明更利于阅读器判断。
         * 放在 className 之后、{...props} 之前：调用方仍可用 props 覆盖（如非模态场景传 false）。
         */
        aria-modal="true"
        className={cn(
          'fixed top-1/2 left-1/2 z-[var(--z-modal)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
          'rounded-xl bg-card p-5 text-card-foreground shadow-lg',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close-button"
            aria-label="关闭"
            className={cn(
              /* 触摸区 44×44（WCAG 2.5.5）：图标 16px 也要有可点的框 */
              'absolute right-2 top-2 grid size-11 place-items-center rounded-md text-muted-foreground',
              'transition-colors duration-150 hover:bg-muted hover:text-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              'disabled:pointer-events-none',
            )}
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  /* pr-12 给右上角 44×44 关闭按钮留位，避免标题被压住 */
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-12', className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      /* mt-5 与迁移前 admin 弹窗底栏一致（视觉零变化门禁要求） */
      className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
