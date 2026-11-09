import { notFound } from 'next/navigation';
import { ProductDetailView } from '@/components/product-detail-view';
import { getStoreProduct } from '@/lib/store-data';

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; channel: string; handle: string }>;
}) {
  // Next.js 16：动态参数是 Promise，必须 await。
  const { locale, channel, handle } = await params;
  const product = await getStoreProduct(handle);
  if (!product) notFound();

  return <ProductDetailView product={product} locale={locale} channel={channel} />;
}
