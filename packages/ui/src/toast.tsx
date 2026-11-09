'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from './lib/cn';

/**
 * 轻量消息提示（Toast）。
 *
 * 为什么不用 sonner：sonner 自带一套 DOM 结构与内联样式，覆盖成我们的 Token
 * 需要大量 `!important` 或穿透选择器；而本项目对 Toast 的需求只有「短暂提示 +
 * 屏幕阅读器播报」。自写一份 130 行的实现，样式完全走 Token、无障碍可控、
 * 不新增依赖，比引一个需要对抗的第三方库更划算。
 *
 * 无障碍要点（这是自写 Toast 最容易漏的地方，逐一说明）：
 * - 视口容器固定 `role="status"` + `aria-live="polite"` + `aria-atomic="false"`：
 *   消息插入时屏幕阅读器会播报，但不打断用户当前朗读（polite）。
 * - 每条消息是容器里的一个普通节点，**不要再套 role="alert"** —— alert 是
 *   强打断语义，只用于错误弹窗这类必须立即处理的场景。
 * - 关闭按钮有独立 `aria-label`，且是 `<button type="button">`，避免误触发表单提交。
 * - 提示不抢焦点（不加 tabIndex、不 focus），否则会打断键盘用户的操作流。
 */

export interface ToastItem {
  id: string;
  message: string;
  /** 毫秒；0 表示不自动消失。默认 3000。 */
  duration?: number;
  tone?: 'neutral' | 'success' | 'danger';
}

interface ToastContextValue {
  toast: (message: string, options?: Omit<ToastItem, 'id' | 'message'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 3000;

const toneClasses: Record<NonNullable<ToastItem['tone']>, string> = {
  neutral: 'border-border bg-card text-card-foreground',
  success: 'border-border bg-card text-card-foreground',
  danger: 'border-destructive bg-card text-destructive',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const seq = React.useRef(0);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = React.useCallback<ToastContextValue['toast']>(
    (message, options) => {
      seq.current += 1;
      const id = `t${seq.current}`;
      const duration = options?.duration ?? DEFAULT_DURATION;
      setItems((prev) => [...prev, { id, message, ...options }].slice(-MAX_VISIBLE));
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  /* 卸载时清掉所有定时器，避免 setState on unmounted component。 */
  React.useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((item) => (
          <div
            key={item.id}
            data-slot="toast"
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border px-3 py-2 shadow-md',
              toneClasses[item.tone ?? 'neutral'],
            )}
          >
            <p className="flex-1 text-sm">{item.message}</p>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => dismiss(item.id)}
              className={cn(
                'mt-0.5 shrink-0 rounded-sm text-muted-foreground opacity-70 transition-opacity',
                'hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              )}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 必须用在 `ToastProvider` 内；脱离 Provider 调用会立刻抛错，不静默失效。 */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast 必须在 <ToastProvider> 内使用（请在应用根部包裹 ToastProvider）');
  }
  return ctx;
}
