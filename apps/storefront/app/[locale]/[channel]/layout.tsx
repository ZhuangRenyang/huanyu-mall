import { CartProvider } from '@/lib/cart-store';
import { Header } from '@/components/header';
import { AffiliateCapture } from '@/components/affiliate-capture';
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
      {/* 推广码落地归因（ADR-101）：任何页面带 ?ref= 都记住，下单时带上 */}
      <AffiliateCapture />
      <div className="flex min-h-dvh flex-col">
        {/* 店铺公告（ADR-047）：Shopify/淘宝的公告条都在页头之上，全站可见 */}
        {profile.announcement && (
          <p
            className="bg-primary-subtle px-4 py-1.5 text-center text-xs text-primary-subtle-foreground"
            role="status"
          >
            {profile.announcement}
          </p>
        )}
        <Header
          locale={locale}
          channel={channel}
          storeName={profile.name}
          storeLogoUrl={profile.logoUrl}
        />
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
