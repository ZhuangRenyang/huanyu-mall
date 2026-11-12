import { ChevronRight } from 'lucide-react';
import { ProductCard } from '@/components/product-card';
import { CategoryGrid } from '@/components/home/category-grid';
import { HomeSearch } from '@/components/home/home-search';
import { getStoreCategories, getStoreProducts } from '@/lib/store-data';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string; channel: string }>;
}) {
  // Next.js 16：动态参数是 Promise，必须 await。
  const { locale, channel } = await params;
  const base = `/${locale}/${channel}`;
  const productsHref = `${base}/products`;
  const [products, categories] = await Promise.all([
    getStoreProducts({ limit: 8, sort: 'created_at.desc' }),
    getStoreCategories(),
  ]);

  return (
    <div className="mx-auto max-w-content px-4 py-6 md:py-10">
      {/* 页面要有 h1：视觉上首屏是搜索框，标题对屏幕阅读器与 SEO 仍然存在 */}
      <h1 className="sr-only">商店首页</h1>
      {/*
        首屏三段，顺序照淘宝：先搜索（最常用的动作）→ 再分类（不搜的时候靠它逛）
        → 最后才是商品流。改造前只有商品网格，搜索与分类都藏在列表页里。
      */}
      <section aria-label="搜索" className="mb-8 md:mb-10">
        <HomeSearch basePath={base} />
      </section>

      {categories.length > 0 && (
        <div className="mb-8 md:mb-10">
          <CategoryGrid categories={categories} basePath={base} />
        </div>
      )}

      <section aria-labelledby="featured-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="featured-heading" className="text-lg md:text-xl">
            当季主推
          </h2>
          <a
            href={productsHref}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            查看全部
            <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
          </a>
        </div>

        {products.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            还没有上架商品
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
            {products.map((product, i) => (
              <ProductCard key={product.id} product={product} basePath={base} priority={i < 4} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
