import { CheckoutFlow } from '@/components/checkout/checkout-flow';

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string; channel: string }>;
}) {
  // Next.js 16：动态参数是 Promise，必须 await。
  const { locale, channel } = await params;

  return <CheckoutFlow locale={locale} channel={channel} />;
}
