import { ActivityOverview } from '@/components/promotions-activities';
import { VoucherTab } from '@/components/promotions-vouchers';
import { GiftCardTab } from '@/components/promotions-gift-cards';
import { PromotionTab } from '@/components/promotions-rules';

/**
 * 营销域四个页面：总览 / 促销 / 优惠券 / 礼品卡。
 *
 * 拆成独立路由而不是一个页面里的 tab：菜单上能直接看到每一项，
 * 商家不用先记住「活动在促销页的第几个 tab」。
 */

function Page({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function MarketingOverviewPage() {
  return (
    <Page title="活动总览" description="所有营销入口集中开关；停用即时生效，历史订单记录不受影响。">
      <ActivityOverview />
    </Page>
  );
}

export function MarketingPromotionsPage() {
  return (
    <Page title="促销" description="自动命中的满减与商品折扣，无需顾客输码。">
      <PromotionTab />
    </Page>
  );
}

export function MarketingVouchersPage() {
  return (
    <Page title="优惠券" description="需要顾客输入券码的优惠，支持一券多码与限额。">
      <VoucherTab />
    </Page>
  );
}

export function MarketingGiftCardsPage() {
  return (
    <Page title="礼品卡" description="预付卡：创建、绑定、调账与流水。">
      <GiftCardTab />
    </Page>
  );
}
