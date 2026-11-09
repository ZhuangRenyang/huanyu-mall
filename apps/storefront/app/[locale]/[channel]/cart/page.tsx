import { CartView } from '@/components/cart-view';

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string; channel: string }>;
}) {
  // Next.js 16：动态参数是 Promise，必须 await。
  const { locale, channel } = await params;

  return <CartView locale={locale} channel={channel} />;
}
