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
  /*
   * 已售罄：淘宝在商品图上盖一层半透明遮罩 + 「已售罄」标签，
   * 顾客在列表里就能判断，不用点进详情才发现买不到（ADR-041）。
   * available 为 undefined（老接口/未取到）时按有货处理，不误报。
   */
  const soldOut = product.available === 0;

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
            className={
              soldOut
                ? "object-cover opacity-60 grayscale transition-transform duration-150"
                : "object-cover transition-transform duration-150 group-hover:scale-[1.02]"
            }
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-secondary" aria-hidden="true" />
        )}
        {product.badge && !soldOut && (
          <Badge variant="promo" className="absolute left-2 top-2">
            {product.badge}
          </Badge>
        )}
        {soldOut && (
          <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
            <span className="rounded-full bg-foreground/75 px-3 py-1 text-xs font-medium text-background">
              已售罄
            </span>
          </span>
        )}
        {soldOut && <span className="sr-only">（已售罄）</span>}
      </a>

      <div className="flex min-h-[76px] flex-col gap-1 pt-2">
        <h3 className="line-clamp-2-safe text-base leading-6 text-foreground">
          <a href={href}>{product.title}</a>
        </h3>
        <span className={soldOut ? 'opacity-60' : undefined}>
          <Price
            amountMinor={product.price?.amount_minor ?? 0}
            currencyCode={product.price?.currency_code ?? 'CNY'}
            originalMinor={product.originalMinor}
            promo={product.originalMinor !== undefined}
            size="base"
          />
        </span>
        {/* 月销 N 件（ADR-070）：淘宝商品卡写「月销」（近 30 天），0 件退回累计已售（ADR-067） */}
        {(product.monthlySoldCount ?? 0) > 0 ? (
          <span className="text-xs text-muted-foreground">月销 {product.monthlySoldCount} 件</span>
        ) : (product.soldCount ?? 0) > 0 ? (
          <span className="text-xs text-muted-foreground">已售 {product.soldCount} 件</span>
        ) : null}
      </div>
    </article>
  );
}
