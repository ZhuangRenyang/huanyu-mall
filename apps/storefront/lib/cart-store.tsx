'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CartLineItemProps } from '@mall/ui';

export interface AddItemInput {
  /** 变体 id（购物车行主键）。 */
  id: string;
  title: string;
  variantTitle?: string;
  unitPriceMinor: number;
  currencyCode: string;
  imageUrl?: string;
  /** 该变体可购上限（库存）。 */
  maxQuantity?: number;
}

interface CartContextValue {
  items: CartLineItemProps[];
  count: number;
  subtotal: { amountMinor: number; currencyCode: string };
  isOpen: boolean;
  errorMessage: string | null;
  /** sessionStorage 回填完成前为 false（避免结账页误判空车）。 */
  hydrated: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  addItem: (input: AddItemInput, qty?: number) => void;
  updateQuantity: (id: string, qty: number) => void;
  removeItem: (id: string) => void;
}

const CartContext = createContext<CartContextValue | null>(null);
const CURRENCY = 'CNY';
const CONFIRM_DELAY = 240; // 模拟服务端确认延迟
const CART_STORAGE_KEY = 'cart:items';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartLineItemProps[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const itemsRef = useRef<CartLineItemProps[]>(items);

  // 回填（sessionStorage）：刷新后购物车不丢，结账可继续
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CART_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartLineItemProps[];
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {
      /* sessionStorage 不可用时降级为内存态 */
    }
    setHydrated(true);
  }, []);

  // 同步最新快照 + 持久化（回填前不写，避免用空数组覆盖）
  useEffect(() => {
    itemsRef.current = items;
    if (!hydrated) return;
    try {
      sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* noop */
    }
  }, [items, hydrated]);

  const openDrawer = useCallback(() => {
    setErrorMessage(null);
    setIsOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);

  const addItem = useCallback((input: AddItemInput, qty = 1) => {
    const prev = itemsRef.current;
    const existing = prev.find((i) => i.id === input.id);
    const nextQty = (existing?.quantity ?? 0) + qty;

    // 1) 乐观更新：先更新 UI 并弹出抽屉
    const optimistic = existing
      ? prev.map((i) => (i.id === input.id ? { ...i, quantity: nextQty } : i))
      : [
          ...prev,
          {
            id: input.id,
            title: input.title,
            variantTitle: input.variantTitle,
            quantity: qty,
            unitPriceMinor: input.unitPriceMinor,
            currencyCode: input.currencyCode,
            imageUrl: input.imageUrl,
            maxQuantity: input.maxQuantity,
          },
        ];
    setItems(optimistic);
    setErrorMessage(null);
    setIsOpen(true);

    // 2) 模拟服务端确认：超库存则回滚并提示
    if (input.maxQuantity !== undefined) {
      window.setTimeout(() => {
        if (nextQty > input.maxQuantity!) {
          setItems(prev);
          setErrorMessage(`库存仅剩 ${input.maxQuantity} 件，已为你回退`);
        }
      }, CONFIRM_DELAY);
    }
  }, []);

  const updateQuantity = useCallback((id: string, qty: number) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, qty) } : i)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const count = useMemo(() => items.reduce((n, i) => n + i.quantity, 0), [items]);
  const subtotal = useMemo(
    () => ({ amountMinor: items.reduce((s, i) => s + i.unitPriceMinor * i.quantity, 0), currencyCode: CURRENCY }),
    [items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      count,
      subtotal,
      isOpen,
      errorMessage,
      hydrated,
      openDrawer,
      closeDrawer,
      addItem,
      updateQuantity,
      removeItem,
    }),
    [items, count, subtotal, isOpen, errorMessage, hydrated, openDrawer, closeDrawer, addItem, updateQuantity, removeItem],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart 必须在 CartProvider 内使用');
  return ctx;
}
