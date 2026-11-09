import { OrdersView } from '@/components/orders/orders-view';

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; channel: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next.js 16：params / searchParams 均为 Promise，必须 await。
  const { locale, channel } = await params;
  const sp = await searchParams;
  const orderId = typeof sp.order === 'string' ? sp.order : undefined;

  return <OrdersView orderId={orderId} locale={locale} channel={channel} />;
}
