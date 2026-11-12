import { ChevronRight } from 'lucide-react';
import { ProductGallery } from '@mall/ui';
import { ProductBuyBox } from './product-buy-box';
import { VoucherStrip } from './vouchers/voucher-strip';
import { ProductReviews } from './product-reviews';
import type { CatalogProduct } from '@/lib/mock-products';
import type { PublicVoucherView } from '@/lib/vouchers';
import type { ProductReviewsView } from '@/lib/reviews';

export interface ProductDetailViewProps {
  product: CatalogProduct;
  locale: string;
  channel: string;
  /** 可领取的店铺券（无券时传空数组，券条自动隐藏）。 */
  vouchers?: PublicVoucherView[];
  voucherCurrency?: string;
  /** 商品评价（含评分摘要）；缺省时整块不渲染。 */
  reviews?: ProductReviewsView;
}

/** PDP 布局：面包屑 → [画廊 | 购买区] → 详情 → 参数表。移动单列，桌面 7:5 非对称。 */
export function ProductDetailView({
  product,
  locale,
  channel,
  vouchers = [],
  voucherCurrency = 'CNY',
  reviews,
}: ProductDetailViewProps) {
  const base = `/${locale}/${channel}`;
  /*
   * 面包屑最多两级：优先展示二级分类（更具体），
   * 没有二级就展示一级。商品挂多个分类时取第一个，避免面包屑变长。
   */
  const categories = product.categories ?? [];
  const leaf = categories.find((c) => c.parentId) ?? categories[0];
  const root = leaf?.parentId ? categories.find((c) => c.id === leaf.parentId) : undefined;
  const breadcrumbCategories = [root, leaf].filter(
    (c): c is NonNullable<typeof c> => Boolean(c),
  );

  return (
    <div className="mx-auto max-w-content px-4 py-6 md:py-8">
      {/*
        面包屑带上所属分类（ADR-040）：淘宝是「首页 > 服饰 > 外套 > 商品」。
        分类是导航的一部分，也是商品页回分类页的内链 —— 之前只有「全部商品」一层。
      */}
      <nav aria-label="面包屑" className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <a href={`${base}/products`} className="transition-colors duration-150 hover:text-foreground">
          全部商品
        </a>
        {breadcrumbCategories.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
            <a
              href={`${base}/products?category=${encodeURIComponent(c.id)}`}
              className="transition-colors duration-150 hover:text-foreground"
            >
              {c.name}
            </a>
          </span>
        ))}
        <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
        <span className="text-foreground">{product.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[7fr_5fr]">
        <div className="lg:sticky lg:top-[calc(var(--chrome-offset)+1rem)] lg:self-start">
          <ProductGallery images={product.images} priority />
        </div>
        <div className="lg:pt-2">
          <ProductBuyBox product={product} />
          {/* 券条紧跟购买区：淘宝也是在价格下方直接挂「领取」 */}
          <VoucherStrip
            vouchers={vouchers}
            currencyCode={voucherCurrency}
            accountHref={`${base}/account`}
          />
        </div>
      </div>

      <section className="mt-12 max-w-prose" aria-labelledby="desc-heading">
        <h2 id="desc-heading" className="mb-3 text-xl">
          商品详情
        </h2>
        <p className="text-base leading-7 text-muted-foreground">{product.description}</p>
      </section>

      {/* 评价在详情之后、参数之前：顾客看完介绍，接着看别人怎么说（淘宝同一顺序） */}
      {reviews && <ProductReviews data={reviews} />}

      {product.attributes.length > 0 && (
        <section className="mt-8 max-w-prose" aria-labelledby="spec-heading">
          <h2 id="spec-heading" className="mb-3 text-xl">
            规格参数
          </h2>
          <dl className="divide-y divide-border rounded-lg border border-border">
            {product.attributes.map((a) => (
              <div key={a.name} className="flex px-4 py-3 text-sm">
                <dt className="w-24 shrink-0 text-muted-foreground">{a.name}</dt>
                <dd className="text-foreground">{a.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
