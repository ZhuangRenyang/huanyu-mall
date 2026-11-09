'use client';

import { Menu, Search, ShoppingBag, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { IconButton } from '@mall/ui';
import { useCart } from '@/lib/cart-store';

export interface HeaderProps {
  locale: string;
  channel: string;
}

/** 顶部导航（移动优先）：Logo / 分类 / 搜索 / 账户 / 购物车。 */
export function Header({ locale, channel }: HeaderProps) {
  const base = `/${locale}/${channel}`;
  const router = useRouter();
  const { count, openDrawer } = useCart();

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-content items-center gap-2 px-4">
        <IconButton aria-label="打开菜单" className="md:hidden">
          <Menu className="size-6" strokeWidth={2} aria-hidden="true" />
        </IconButton>

        <a href={base} className="text-lg font-semibold tracking-tight">
          全球商城
        </a>

        <nav className="ml-6 hidden items-center gap-5 md:flex" aria-label="分类导航">
          <a href={`${base}/products`} className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground">
            全部商品
          </a>
          <a href={`${base}/products`} className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground">
            数码配件
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <IconButton aria-label="搜索" className="md:hidden">
            <Search className="size-6" strokeWidth={2} aria-hidden="true" />
          </IconButton>
          <div className="hidden items-center md:flex">
            <label className="relative block">
              <span className="sr-only">搜索商品</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
              <input
                type="search"
                inputMode="search"
                placeholder="搜索商品"
                className="h-11 w-56 rounded-md border border-input bg-background pl-10 pr-3 text-sm outline-none transition-colors duration-150 focus:border-ring"
              />
            </label>
          </div>
          <IconButton aria-label="账户" onClick={() => router.push(`${base}/account`)}>
            <User className="size-6" strokeWidth={2} aria-hidden="true" />
          </IconButton>
          <IconButton aria-label="打开购物车" aria-haspopup="dialog" className="relative" onClick={openDrawer}>
            <ShoppingBag className="size-6" strokeWidth={2} aria-hidden="true" />
            {count > 0 && (
              <span className="tabular absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-accent-orange text-[10px] font-medium text-accent-orange-foreground">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </IconButton>
        </div>
      </div>
    </header>
  );
}
