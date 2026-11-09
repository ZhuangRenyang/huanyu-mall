import { ChevronRight } from 'lucide-react';
import { ProductCard } from '@/components/product-card';
import { getStoreProducts } from '@/lib/store-data';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string; channel: string }>;
}) {
  // Next.js 16：动态参数是 Promise，必须 await。
  const { locale, channel } = await params;
  const base = `/${locale}/${channel}`;
  const productsHref = `${base}/products`;
  const products = await getStoreProducts({ limit: 8, sort: 'created_at.desc' });

  return (
    <div className="mx-auto max-w-content px-4 py-6 md:py-10">
      {/* 首屏直接商品网格，无 Hero。首排 4 个商品优先加载（LCP）。 */}
      <section aria-labelledby="featured-heading">
        <div className="mb-4 flex items-center justify-between">
          <h1 id="featured-heading" className="text-xl md:text-2xl">
            当季主推
          </h1>
          <a
            href={productsHref}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            查看全部
            <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
          {products.map((product, i) => (
            <ProductCard key={product.id} product={product} basePath={base} priority={i < 4} />
          ))}
        </div>
      </section>
    </div>
  );
}
