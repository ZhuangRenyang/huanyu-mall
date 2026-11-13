'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Heart } from 'lucide-react';
import { EmptyState, Price, Skeleton } from '@mall/ui';
import { fetchFavorites } from '@/lib/favorites';
import type { StoreProduct } from '@/lib/catalog';

/**
 * 我的收藏（ADR-048）。
 *
 * 淘宝的「收藏夹」：账户页里能看到收藏过的商品，点回商品页。
 * 下架商品不在列表里（服务端只返回 published），收藏记录本身保留。
 */
export function MyFavorites() {
  const pathname = usePathname();
  // 账户页地址是 /{locale}/{channel}/account，把末段去掉就是站点前缀
  const base = pathname.replace(/\/account.*$/, '');
  const [items, setItems] = useState<StoreProduct[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchFavorites({ limit: 12 })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setCount(res.count);
      })
      .catch(() => {
        if (!cancelled) setError('读取收藏失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="favorites-heading">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 id="favorites-heading" className="text-base font-semibold">
          我的收藏
        </h2>
        {count > 0 && <span className="tabular text-sm text-muted-foreground">{count} 件</span>}
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="还没有收藏"
          description="商品详情页点「收藏」，之后就能在这里找到它"
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {items.map((p) => (
            <li key={p.id} className="group flex flex-col">
              <a
                href={`${base}/products/${p.handle}`}
                className="relative block aspect-product overflow-hidden rounded-lg bg-secondary"
              >
                {p.thumbnail_url ? (
                  <Image
                    src={p.thumbnail_url}
                    alt={p.title}
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover transition-transform duration-150 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="absolute inset-0 bg-secondary" aria-hidden="true" />
                )}
                {p.available === 0 && (
                  <span className="absolute inset-0 grid place-items-center bg-foreground/60 text-xs text-background">
                    已售罄
                  </span>
                )}
              </a>
              <a href={`${base}/products/${p.handle}`} className="mt-2 line-clamp-2-safe text-sm text-foreground">
                {p.title}
              </a>
              <Price
                amountMinor={p.price?.amount_minor ?? 0}
                currencyCode={p.price?.currency_code ?? 'CNY'}
                size="sm"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
