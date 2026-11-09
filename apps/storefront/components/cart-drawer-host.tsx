'use client';

import { useRouter } from 'next/navigation';
import { CartDrawer } from '@mall/ui';
import { useCart } from '@/lib/cart-store';

/** 全局购物车抽屉宿主：把 cart store 绑定到 packages/ui 的 M18 CartDrawer。 */
export function CartDrawerHost({ locale, channel }: { locale: string; channel: string }) {
  const router = useRouter();
  const { isOpen, closeDrawer, items, subtotal, updateQuantity, removeItem, errorMessage } = useCart();

  return (
    <CartDrawer
      open={isOpen}
      onClose={closeDrawer}
      items={items}
      subtotal={subtotal}
      onQuantityChange={updateQuantity}
      onRemove={removeItem}
      onCheckout={() => {
        closeDrawer();
        router.push(`/${locale}/${channel}/cart`);
      }}
      errorMessage={errorMessage ?? undefined}
    />
  );
}
