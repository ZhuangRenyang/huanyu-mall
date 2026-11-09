import { AccountView } from '@/components/account/account-view';

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string; channel: string }>;
}) {
  // Next.js 16：动态参数是 Promise，必须 await（本页未直接使用）。
  await params;

  return <AccountView />;
}
