import { notFound } from 'next/navigation';
import { ProductDetailView } from '@/components/product-detail-view';
import { getStoreProduct } from '@/lib/store-data';
import { getStoreVouchers } from '@/lib/vouchers';
import { getProductReviews } from '@/lib/reviews';

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; channel: string; handle: string }>;
}) {
  // Next.js 16：动态参数是 Promise，必须 await。
  const { locale, channel, handle } = await params;
  const product = await getStoreProduct(handle);
  if (!product) notFound();

  // 评价与券都在拿到商品之后拉：mock 模式下评价按商品标题归类
  const [vouchers, reviews] = await Promise.all([
    // 只取本商品可用的券（ADR-071）：全店券列表会混进「限别的商品」的券
    getStoreVouchers(product.handle),
    getProductReviews(handle, product.title),
  ]);

  return (
    <ProductDetailView
      product={product}
      locale={locale}
      channel={channel}
      vouchers={vouchers.items}
      voucherCurrency={vouchers.currencyCode}
      reviews={reviews}
    />
  );
}
