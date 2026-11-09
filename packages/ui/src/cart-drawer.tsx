'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ShoppingBag, Trash2, X } from 'lucide-react';
import { cn } from './lib/cn';
import { formatMoney } from './lib/format';
import { Button } from './button';
import { IconButton } from './icon-button';
import { QuantityStepper } from './quantity-stepper';
import type { CartLineItemProps, MoneyValue } from './types';

export interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  items: CartLineItemProps[];
  subtotal: MoneyValue;
  onQuantityChange: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
  /** 改量/删除失败时，顶部横幅提示（可含原因）。 */
  errorMessage?: string;
}

/** 触发图标可访问约定：父组件传 role="button" + aria-haspopup="dialog"。 */
export function CartDrawer({
  open,
  onClose,
  items,
  subtotal,
  onQuantityChange,
  onRemove,
  onCheckout,
  errorMessage,
}: CartDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 滚动锁 + 焦点归还触发元素
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      document.body.style.overflow = 'hidden';
      // 滑入（200ms）结束后焦点落到关闭按钮，便于键盘路径
      const t = window.setTimeout(() => {
        panelRef.current?.querySelector<HTMLButtonElement>('[data-drawer-close]')?.focus();
      }, 200);
      return () => {
        window.clearTimeout(t);
        document.body.style.overflow = '';
        (triggerRef.current as HTMLElement | null)?.focus?.();
      };
    }
  }, [open]);

  /**
   * 焦点陷阱：Tab / Shift+Tab 在抽屉内循环，不跑到背后的页面。
   *
   * 为什么这里不用 `Sheet`（Radix Dialog）替换整个容器：本组件是可嵌入组件，
   * 容器带大量移动端定制（`min(440px, calc(100vw-48px))` 宽度、安全区内边距
   * `--safe-area-bottom`、`ease-emphasized` 滑入动画、移动端遮罩浓度），
   * 换成通用 Sheet 会把这些产品细节压平。它已具备 Esc / 滚动锁 / 焦点归还，
   * 唯一缺口就是焦点陷阱 —— 所以只补这一项，不动容器。
   * 彻底 headless 化（逻辑与 UI 分离，供任意模板注入样式）记在 ADR-011 的遗留项。
   */
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) return;
      /* 用 at() + 显式空判，避免 noUncheckedIndexedAccess 下的 undefined 访问 */
      const first = nodes.at(0);
      const last = nodes.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !panel.contains(active);

      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const itemCount = items.reduce((n, it) => n + it.quantity, 0);
  const close = useCallback(() => onClose(), [onClose]);

  return (
    <div inert={!open} aria-hidden={!open}>
      {/* 遮罩 */}
      <div
        className={cn(
          'fixed inset-0 z-[var(--z-drawer)] bg-neutral-900/50 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* 面板 */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="购物车"
        className={cn(
          'fixed right-0 top-0 z-[var(--z-drawer)] flex h-full w-[min(440px,calc(100vw-48px))] flex-col',
          'bg-card shadow-lg transition-transform duration-200 ease-emphasized',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold">购物车（{itemCount}）</h2>
          <IconButton aria-label="关闭购物车" data-drawer-close onClick={close}>
            <X className="size-5" strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </header>

        {errorMessage && (
          <div className="mx-4 mt-3 rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive" role="alert">
            {errorMessage}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <ShoppingBag className="size-6 text-neutral-300" strokeWidth={2} aria-hidden="true" />
              <p className="text-base font-medium">购物车还是空的</p>
              <p className="text-sm text-muted-foreground">看看本周新到的商品，满 ¥199 免运费</p>
              <Button variant="secondary" size="md" className="mt-2" onClick={close}>
                去逛逛
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex gap-3 py-4">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      loading="lazy"
                      className="aspect-square w-16 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <div className="aspect-square w-16 shrink-0 rounded-sm bg-secondary" aria-hidden="true" />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="line-clamp-2-safe text-sm text-foreground">{item.title}</p>
                    {item.variantTitle && <p className="text-xs text-muted-foreground">{item.variantTitle}</p>}
                    <div className="mt-auto flex items-center justify-between">
                      <QuantityStepper
                        value={item.quantity}
                        max={item.maxQuantity}
                        onChange={(q) => onQuantityChange(item.id, q)}
                        decreaseLabel={`减少 ${item.title} 数量`}
                        increaseLabel={`增加 ${item.title} 数量`}
                      />
                      <span className="tabular text-sm">{formatMoney(item.unitPriceMinor, item.currencyCode)}</span>
                    </div>
                  </div>

                  <IconButton aria-label={`移除 ${item.title}`} size="sm" onClick={() => onRemove(item.id)}>
                    <Trash2 className="size-5" strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="space-y-3 border-t border-border px-4 py-4 pb-[calc(1rem+var(--safe-area-bottom))]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">小计</span>
            <span className="tabular text-xl font-semibold">{formatMoney(subtotal.amountMinor, subtotal.currencyCode)}</span>
          </div>
          <Button size="lg" className="w-full" onClick={onCheckout} disabled={items.length === 0}>
            去结算
          </Button>
          <button
            type="button"
            onClick={close}
            className="w-full text-center text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            继续购物
          </button>
        </footer>
      </div>
    </div>
  );
}
