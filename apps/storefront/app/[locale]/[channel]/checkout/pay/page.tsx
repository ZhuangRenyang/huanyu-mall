import { PaymentPay } from '@/components/checkout/payment-pay';

export default async function PaymentPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; channel: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next.js 16：params / searchParams 均为 Promise，必须 await。
  const { locale, channel } = await params;
  const sp = await searchParams;
  const orderId = typeof sp.order === 'string' ? sp.order : '';

  return <PaymentPay orderId={orderId} locale={locale} channel={channel} />;
}
