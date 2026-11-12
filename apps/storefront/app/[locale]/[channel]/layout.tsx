import { CartProvider } from '@/lib/cart-store';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CartDrawerHost } from '@/components/cart-drawer-host';
import { ThemeInjector } from '@/components/theme-injector';
import { getStoreProfile } from '@/lib/store-data';

export default async function ChannelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; channel: string }>;
}) {
  const { locale, channel } = await params;
  const profile = await getStoreProfile();

  return (
    <CartProvider>
      <ThemeInjector />
      <div className="flex min-h-dvh flex-col">
        <Header locale={locale} channel={channel} storeName={profile.name} />
        <main className="flex-1">{children}</main>
        <Footer
          locale={locale}
          channel={channel}
          storeName={profile.name}
          supportPhone={profile.supportPhone}
        />
        <CartDrawerHost locale={locale} channel={channel} />
      </div>
    </CartProvider>
  );
}
