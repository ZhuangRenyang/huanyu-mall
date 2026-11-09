import { CartProvider } from '@/lib/cart-store';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CartDrawerHost } from '@/components/cart-drawer-host';
import { ThemeInjector } from '@/components/theme-injector';

export default async function ChannelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; channel: string }>;
}) {
  const { locale, channel } = await params;

  return (
    <CartProvider>
      <ThemeInjector />
      <div className="flex min-h-dvh flex-col">
        <Header locale={locale} channel={channel} />
        <main className="flex-1">{children}</main>
        <Footer locale={locale} channel={channel} />
        <CartDrawerHost locale={locale} channel={channel} />
      </div>
    </CartProvider>
  );
}
