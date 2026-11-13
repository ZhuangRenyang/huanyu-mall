import { OrdersView } from '@/components/orders/orders-view';
import { getStoreProfile } from '@/lib/store-data';

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

  // 退货地址是店铺配置（ADR-053），在服务端取一次传下去，别让明细组件自己再打一次接口
  const profile = await getStoreProfile();

  return (
    <OrdersView
      orderId={orderId}
      locale={locale}
      channel={channel}
      returnAddress={profile.returnAddress}
    />
  );
}
