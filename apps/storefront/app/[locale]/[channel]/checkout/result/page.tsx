import { PaymentResult } from '@/components/checkout/payment-result';

export default async function PaymentResultPage({
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
  const raw = sp.simulate;
  const simulate = raw === 'failed' || raw === 'processing' ? raw : undefined;

  return <PaymentResult orderId={orderId} simulate={simulate} locale={locale} channel={channel} />;
}
