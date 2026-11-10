'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CartLineItemProps } from '@mall/ui';
import { getApiMode } from '@/lib/api';
import {
  addToLiveCart,
  applyLiveCart,
  fetchLiveCart,
  getLiveCartId,
  removeLiveCartLine,
  resetLiveCart,
  setLiveCartQuantity,
} from '@/lib/live-cart';
import { describeError } from '@/lib/checkout';

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
  /**
   * 清空购物车。
   *
   * live 模式还会丢弃后端购物车：下一单必须用新车 —— 一辆车只能出一笔单
   * （后端按 cart_id 反查订单，而 listOrders 没有 ORDER BY），
   * 复用旧车会让新提交挂到上一笔订单上。
   */
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);
const CART_STORAGE_KEY = 'cart:items';
const CONFIRM_DELAY = 240; // 模拟服务端确认延迟（仅 mock 模式）

export function CartProvider({ children }: { children: React.ReactNode }) {
  // NEXT_PUBLIC_* 在构建期内联进客户端 bundle，同一份产物里只会命中一种模式。
  const live = getApiMode() === 'live';
  const [items, setItems] = useState<CartLineItemProps[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * 购物车最新快照。
   *
   * 不用 React state 直接读：写后端的回调是异步的，那时 state 可能还没刷新，
   * 读到的旧数组会把并发写的结果覆盖掉。这里同步维护一份，写回调永远读到最新值。
   */
  const itemsRef = useRef<CartLineItemProps[]>(items);
  /** 正在写后端的变体：这些行的本地乐观值要保留，避免行在两次写之间闪没。 */
  const pendingRef = useRef<Set<string>>(new Set());

  /** 统一的本地状态更新（ref 与 state 同步改）。 */
  const commit = useCallback((next: CartLineItemProps[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  // 回填：mock 读 sessionStorage；live 以后端购物车为准（服务端是唯一事实来源）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = readLocalItems();
      if (!live) {
        if (!cancelled) commit(local);
        setHydrated(true);
        return;
      }
      // 先用本地缓存渲染（避免空白闪烁），再以服务端为准覆盖。
      if (!cancelled && local.length > 0) commit(local);
      const cartId = getLiveCartId();
      if (cartId) {
        try {
          const cart = await fetchLiveCart(cartId);
          if (cancelled) return;
          // 服务端是准的：本地多出来的行丢掉（正在写的行除外，见 pendingRef）。
          commit(applyLiveCart(itemsRef.current, cart, pendingRef.current));
        } catch {
          // 购物车已被后端清理（过期/已完成）：丢弃本地缓存，从空车开始。
          if (!cancelled) commit([]);
        }
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [live, commit]);

  // 持久化（回填前不写，避免用空数组覆盖）
  useEffect(() => {
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

  /**
   * 加购。
   *
   * mock：本地乐观更新 + 模拟库存确认。
   * live：同步后端购物车 —— 首次加购时建车；同一变体再点走改量
   * （后端 addLineItem 每次都插新行、不会合并同变体，插两行就是重复扣款）。
   */
  const addItem = useCallback(
    (input: AddItemInput, qty = 1) => {
      const prev = itemsRef.current;
      const existing = prev.find((i) => i.id === input.id);
      const nextQty = (existing?.quantity ?? 0) + qty;

      // 乐观更新：先更新 UI 并弹出抽屉
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
      commit(optimistic);
      setErrorMessage(null);
      setIsOpen(true);

      // 库存上限来自产品页（live 模式取后端 available_quantity），先本地拦一道。
      if (input.maxQuantity !== undefined && nextQty > input.maxQuantity) {
        commit(prev);
        setErrorMessage(`库存仅剩 ${input.maxQuantity} 件，已为你回退`);
        return;
      }

      if (!live) {
        // 模拟服务端确认：超库存则回滚并提示
        window.setTimeout(() => {
          if (nextQty > (input.maxQuantity ?? Infinity)) {
            commit(prev);
            setErrorMessage(`库存仅剩 ${input.maxQuantity} 件，已为你回退`);
          }
        }, CONFIRM_DELAY);
        return;
      }

      pendingRef.current.add(input.id);
      void (async () => {
        try {
          const cart = await addToLiveCart(input.id, qty);
          commit(applyLiveCart(itemsRef.current, cart, pendingRef.current));
        } catch (err) {
          commit(await resyncOr(prev));
          setErrorMessage(describeError(err));
        } finally {
          pendingRef.current.delete(input.id);
        }
      })();
    },
    [live, commit],
  );

  const updateQuantity = useCallback(
    (id: string, qty: number) => {
      const prev = itemsRef.current;
      const next = Math.max(1, qty);
      commit(prev.map((i) => (i.id === id ? { ...i, quantity: next } : i)));
      if (!live) return;
      pendingRef.current.add(id);
      void (async () => {
        try {
          const cart = await setLiveCartQuantity(id, next);
          commit(applyLiveCart(itemsRef.current, cart, pendingRef.current));
        } catch (err) {
          commit(await resyncOr(prev));
          setErrorMessage(describeError(err));
        } finally {
          pendingRef.current.delete(id);
        }
      })();
    },
    [live, commit],
  );

  const removeItem = useCallback(
    (id: string) => {
      const prev = itemsRef.current;
      commit(prev.filter((i) => i.id !== id));
      if (!live) return;
      pendingRef.current.add(id);
      void (async () => {
        try {
          const cart = await removeLiveCartLine(id);
          commit(applyLiveCart(itemsRef.current, cart, pendingRef.current));
        } catch (err) {
          commit(await resyncOr(prev));
          setErrorMessage(describeError(err));
        } finally {
          pendingRef.current.delete(id);
        }
      })();
    },
    [live, commit],
  );

  const clearCart = useCallback(() => {
    commit([]);
    if (live) resetLiveCart();
  }, [live, commit]);

  const count = useMemo(() => items.reduce((n, i) => n + i.quantity, 0), [items]);
  const subtotal = useMemo(
    () => ({
      amountMinor: items.reduce((s, i) => s + i.unitPriceMinor * i.quantity, 0),
      currencyCode: items[0]?.currencyCode ?? 'CNY',
    }),
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
      clearCart,
    }),
    [
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
      clearCart,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * 写失败后回到「与服务端一致」的状态。
 *
 * 直接回滚到写之前的本地快照可能覆盖掉并发写已经落地的结果，
 * 所以优先重新拉一次服务端购物车；拉不到才退回本地快照。
 */
async function resyncOr(fallback: CartLineItemProps[]): Promise<CartLineItemProps[]> {
  const cartId = getLiveCartId();
  if (!cartId) return fallback;
  try {
    const cart = await fetchLiveCart(cartId);
    return applyLiveCart(fallback, cart);
  } catch {
    return fallback;
  }
}

function readLocalItems(): CartLineItemProps[] {
  try {
    const raw = sessionStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartLineItemProps[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    /* sessionStorage 不可用时降级为内存态 */
    return [];
  }
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart 必须在 CartProvider 内使用');
  return ctx;
}
