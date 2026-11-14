import { ChevronRight } from 'lucide-react';
import { ProductCard } from '@/components/product-card';
import { CategoryGrid } from '@/components/home/category-grid';
import { HomeSearch } from '@/components/home/home-search';
import { VoucherStrip } from '@/components/vouchers/voucher-strip';
import { getStoreCategories, getStoreProducts, getStoreProfile } from '@/lib/store-data';
import { getStoreVouchers } from '@/lib/vouchers';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string; channel: string }>;
}) {
  // Next.js 16：动态参数是 Promise，必须 await。
  const { locale, channel } = await params;
  const base = `/${locale}/${channel}`;
  const productsHref = `${base}/products`;
  const [products, categories, profile, vouchers] = await Promise.all([
    getStoreProducts({ limit: 8, sort: 'created_at.desc' }),
    getStoreCategories(),
    getStoreProfile(),
    getStoreVouchers(),
  ]);

  /*
   * 首页模块顺序来自装修（ADR-079）：搜索固定在最前（最常用的动作），
   * 其余按商家排的顺序渲染；关掉的模块整段不出现，不留空档。
   */
  const modules = profile.homeModules.filter((m) => m.enabled);

  return (
    <div className="mx-auto max-w-content px-4 py-6 md:py-10">
      {/* 页面要有 h1：视觉上首屏是搜索框，标题对屏幕阅读器与 SEO 仍然存在 */}
      <h1 className="sr-only">商店首页</h1>
      <section aria-label="搜索" className="mb-8 md:mb-10">
        <HomeSearch basePath={base} />
      </section>

      {modules.map((module) => {
        if (module.id === 'categories') {
          if (categories.length === 0) return null;
          return (
            <div key={module.id} className="mb-8 md:mb-10">
              <CategoryGrid categories={categories} basePath={base} />
            </div>
          );
        }
        if (module.id === 'vouchers') {
          // 已领过的券不在首页再挂一遍：首页是「发现」，卡券包才是「我的」
          const usable = vouchers.items.filter((v) => !v.collected);
          if (usable.length === 0) return null;
          return (
            <div key={module.id} className="mb-4">
              <VoucherStrip
                vouchers={usable}
                currencyCode={vouchers.currencyCode}
                accountHref={`${base}/account`}
              />
            </div>
          );
        }
        return (
          <section key={module.id} aria-labelledby="featured-heading" className="mb-8">
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
        );
      })}
    </div>
  );
}
