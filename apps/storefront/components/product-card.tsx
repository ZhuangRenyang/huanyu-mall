import Image from 'next/image';
import { Badge, Price } from '@mall/ui';
import type { StoreProduct } from '@/lib/mock-products';

export interface ProductCardProps {
  product: StoreProduct;
  /** 语言+渠道前缀，如 `/zh-CN/cn`，用于拼详情链接。 */
  basePath: string;
  /** 首屏首排图 preload（LCP）。 */
  priority?: boolean;
}

/** 商品卡：4:5 图 + 两行标题 + 价格（促销含划线原价）。标题是链接。 */
export function ProductCard({ product, basePath, priority = false }: ProductCardProps) {
  const href = `${basePath}/products/${product.handle}`;

  return (
    <article className="group flex flex-col">
      <a href={href} className="relative block aspect-product overflow-hidden rounded-lg bg-secondary">
        {product.thumbnail_url ? (
          <Image
            src={product.thumbnail_url}
            alt={product.title}
            fill
            priority={priority}
            sizes="(max-width: 640px) 50vw, 25vw"
            className="object-cover transition-transform duration-150 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-secondary" aria-hidden="true" />
        )}
        {product.badge && (
          <Badge variant="promo" className="absolute left-2 top-2">
            {product.badge}
          </Badge>
        )}
      </a>

      <div className="flex min-h-[76px] flex-col gap-1 pt-2">
        <h3 className="line-clamp-2-safe text-base leading-6 text-foreground">
          <a href={href}>{product.title}</a>
        </h3>
        <Price
          amountMinor={product.price?.amount_minor ?? 0}
          currencyCode={product.price?.currency_code ?? 'CNY'}
          originalMinor={product.originalMinor}
          promo={product.originalMinor !== undefined}
          size="base"
        />
      </div>
    </article>
  );
}
