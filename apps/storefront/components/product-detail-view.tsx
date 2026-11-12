import { ChevronRight } from 'lucide-react';
import { ProductGallery } from '@mall/ui';
import { ProductBuyBox } from './product-buy-box';
import { VoucherStrip } from './vouchers/voucher-strip';
import type { CatalogProduct } from '@/lib/mock-products';
import type { PublicVoucherView } from '@/lib/vouchers';

export interface ProductDetailViewProps {
  product: CatalogProduct;
  locale: string;
  channel: string;
  /** 可领取的店铺券（无券时传空数组，券条自动隐藏）。 */
  vouchers?: PublicVoucherView[];
  voucherCurrency?: string;
}

/** PDP 布局：面包屑 → [画廊 | 购买区] → 详情 → 参数表。移动单列，桌面 7:5 非对称。 */
export function ProductDetailView({
  product,
  locale,
  channel,
  vouchers = [],
  voucherCurrency = 'CNY',
}: ProductDetailViewProps) {
  const base = `/${locale}/${channel}`;

  return (
    <div className="mx-auto max-w-content px-4 py-6 md:py-8">
      <nav aria-label="面包屑" className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <a href={`${base}/products`} className="transition-colors duration-150 hover:text-foreground">
          全部商品
        </a>
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
