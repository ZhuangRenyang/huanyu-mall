'use client';

import * as React from 'react';
import { Toaster as SonnerToaster, toast, useSonner } from 'sonner';

/**
 * Toast —— 基于 sonner 的轻量消息提示（shadcn/ui 体系里 Toast 的标准做法）。
 *
 * 为什么不自己写一套：sonner 已经解决了「多条堆叠、自动消失、手势关闭、计时重置、
 * 视口自适应」这些细节，自己写等于重造一个更差的轮子。我们只做两件事：
 * 1. 把 sonner 默认皮肤（白底 + 灰边）替换成我们的 Token；
 * 2. 把无障碍语义固定下来，不让调用方各写各的。
 *
 * 无障碍要点（sonner 已实现，这里只做约束与说明）：
 * - 外层是 `role="region"` 级别的 `<section aria-live="polite" aria-atomic="false">`，
 *   每条 toast 插入时被播报，但**不打断**用户当前朗读（polite 而非 assertive）。
 * - 关闭按钮由 `closeButton` 渲染，带独立可读名，不抢焦点。
 * - 提示不主动 focus，避免打断键盘用户的操作流。
 *
 * ⚠️ 主题接管为什么用**行内 style** 而不是 CSS 规则：
 * sonner v2 在运行时把自己的样式表 `appendChild` 到 <head>，落点在应用样式表**之后**；
 * 若我们用同优先级的 CSS 规则覆盖变量，sonner 的后注入规则会赢（白底又回来了）。
 * 行内 style 优先级高于任何样式表规则，与注入顺序无关 —— 这是唯一稳定的接管方式。
 * 需要作用于 toast **后代**（关闭按钮尺寸）的样式无法行内化，放在 `sonner.css`，
 * 用 `body` 前缀提高一级特异性来压过 sonner 的规则。
 */

/** 提示语义：与 design-tokens 的语义色一一对应（中性 / 成功 / 危险）。 */
export type ToastTone = 'neutral' | 'success' | 'danger';

/**
 * 主题变量 —— 全部指向 design-tokens 的语义变量。
 *
 * 注意：语义态只换**文字色**，底色仍是卡片色 —— 大面积彩色块会与品牌蓝抢注意力，
 * 且在深色模式下极易刺眼（design-tokens 的已知坑清单里也强调过）。
 */
const tokenTheme = {
  '--normal-bg': 'var(--card)',
  '--normal-text': 'var(--card-foreground)',
  '--normal-border': 'var(--border)',
  '--normal-bg-hover': 'var(--muted)',
  '--normal-border-hover': 'var(--border-strong)',
  '--success-bg': 'var(--card)',
  '--success-text': 'var(--success)',
  '--success-border': 'var(--border)',
  '--error-bg': 'var(--card)',
  '--error-text': 'var(--destructive)',
  '--error-border': 'var(--border)',
  '--warning-bg': 'var(--card)',
  '--warning-text': 'var(--warning)',
  '--warning-border': 'var(--border)',
  '--info-bg': 'var(--card)',
  '--info-text': 'var(--info)',
  '--info-border': 'var(--border)',
  '--border-radius': 'var(--radius)',
  fontFamily: 'var(--font-family-sans)',
  zIndex: 'var(--z-toast)',
} as React.CSSProperties;

/**
 * Token 皮肤 —— 只覆盖 sonner 的 classNames，不改它的行为。
 *
 * 这些类名是给「我们自己的组件」用的（例如自定义 action 按钮）；
 * toast 本体的底色/文字色由上面的 CSS 变量决定（见 tokenTheme）。
 */
const tokenClassNames = {
  toast: 'group flex items-start gap-2 rounded-md border border-border bg-card text-card-foreground',
  title: 'text-sm font-medium text-card-foreground',
  description: 'text-sm text-muted-foreground',
  actionButton: 'rounded-md bg-primary px-2 py-1 text-sm text-primary-foreground',
  cancelButton: 'rounded-md bg-muted px-2 py-1 text-sm text-muted-foreground',
  closeButton:
    'text-muted-foreground opacity-70 transition-opacity duration-150 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
} as const;

export interface ToasterProps extends React.ComponentProps<typeof SonnerToaster> {}

/**
 * Toast 视口。挂在应用根部：
 *
 * ```tsx
 * <Toaster position="top-center" />
 * ```
 *
 * `toastOptions.classNames` 用调用方传入的值覆盖默认皮肤（浅合并），
 * 这样单个应用想换语气时不必改组件库。
 */
export function Toaster({ toastOptions, style, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      position="top-center"
      closeButton
      richColors={false}
      style={{ ...tokenTheme, ...style }}
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...tokenClassNames,
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
}

/**
 * 透传 sonner 的 `useSonner`（返回当前 toasts 列表）。
 * 命名保持与上游一致，不另造 `useToast` —— 两套近似的 hook 名只会让人猜。
 */
export { toast, useSonner };
