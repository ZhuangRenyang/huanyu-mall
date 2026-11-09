'use client';

import { useEffect, useState } from 'react';
import { ImageOff, Search } from 'lucide-react';
import { ProductCard } from './product-card';
import { getApiMode, getStoreClient } from '@/lib/api';
import type { StoreProduct } from '@/lib/mock-products';

/** 404 内容（全局 not-found 与 channel 内 not-found 复用）。搜索用原生 GET 表单，无需 JS。 */
export function NotFoundContent({ base = '/zh-CN/cn' }: { base?: string }) {
  // 推荐位放到客户端取数：构建期预渲染 /_not-found 时不触碰 API（否则构建容器解析不到 api 主机）
  const [products, setProducts] = useState<StoreProduct[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (getApiMode() === 'live') {
          const res = (await getStoreClient().listProducts({ limit: 4 })) as { items?: StoreProduct[] };
          if (!cancelled) setProducts(res.items ?? []);
        } else {
          const mock = await import('@/lib/catalog-mock');
          if (!cancelled) setProducts(mock.mockProducts.slice(0, 4));
        }
      } catch {
        /* 推荐位失败不阻塞 404 页 */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-content px-4 py-16">
      <div className="mx-auto max-w-narrow text-center">
        <ImageOff className="mx-auto size-6 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-semibold">这个页面不见了</h1>
        <p className="mt-2 text-sm text-muted-foreground">链接可能已失效，或者商品已经下架</p>

        <form action={`${base}/products`} method="get" className="mx-auto mt-6 flex max-w-sm gap-2">
          <label className="relative flex-1">
            <span className="sr-only">搜索商品</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
            <input
              name="q"
              type="search"
              placeholder="搜索商品"
              aria-label="搜索商品"
              className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-ring"
            />
          </label>
          <button
            type="submit"
            className="h-11 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary-hover"
          >
            搜索
          </button>
        </form>

        <a href={base} className="mt-4 inline-block text-sm text-primary transition-colors duration-150 hover:underline">
          回到首页
        </a>
      </div>

      <section className="mt-14" aria-labelledby="reco-heading">
        <h2 id="reco-heading" className="mb-4 text-lg font-semibold">
          顺便看看这些
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
          {products.slice(0, 4).map((p, i) => (
            <ProductCard key={p.id} product={p} basePath={base} priority={i === 0} />
          ))}
        </div>
      </section>
    </div>
  );
}
