'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { History } from 'lucide-react';
import { Button, formatMoney } from '@mall/ui';
import { clearRecent, listRecent, type RecentView } from '@/lib/recently-viewed';

/**
 * 我的足迹（ADR-063）。
 *
 * 淘宝「我的淘宝 → 我的足迹」：最近看过的商品，点回商品页。
 * 位置紧跟「我的收藏」—— 两者都是「我看过/我想要」，中间隔别的会把它们拆散。
 *
 * 数据只在本机（见 lib/recently-viewed.ts 的说明），所以标题旁必须写清楚，
 * 不能让顾客以为换台设备也能看到。
 */
export function MyFootprints() {
  const pathname = usePathname();
  // 账户页地址是 /{locale}/{channel}/account，把末段去掉就是站点前缀
  const base = pathname.replace(/\/account.*$/, '');
  const [items, setItems] = useState<RecentView[]>([]);
  const [mounted, setMounted] = useState(false);

  // localStorage 只能在客户端读：首次渲染前是空的，挂载后再填，避免水合不一致
  useEffect(() => {
    setItems(listRecent());
    setMounted(true);
  }, []);

  // 还没挂载（或确实没有足迹）时不渲染：空区块比没有区块更碍眼
  if (!mounted || items.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="footprints-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
          <h2 id="footprints-heading" className="text-base font-semibold">
            我的足迹
          </h2>
          <span className="text-xs text-muted-foreground">只记录在这台设备上</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            clearRecent();
            setItems([]);
          }}
        >
          清空足迹
        </Button>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.productId}>
            <a
              href={`${base}/products/${encodeURIComponent(item.handle)}`}
              className="group block overflow-hidden rounded-md border border-border transition-colors duration-150 hover:border-ring"
            >
              <div className="relative aspect-product bg-secondary">
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    alt={item.title}
                    fill
                    sizes="(max-width: 640px) 50vw, 200px"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="p-2">
                <p className="line-clamp-2-safe text-sm text-foreground group-hover:text-primary">
                  {item.title}
                </p>
                <p className="tabular mt-1 text-sm font-medium">
                  {formatMoney(item.priceMinor, item.currencyCode)}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
