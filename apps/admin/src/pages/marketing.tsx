import { MarketingFeatureSwitch } from '@/components/marketing-feature-switch';
import { VoucherTab } from '@/components/promotions-vouchers';
import { GiftCardTab } from '@/components/promotions-gift-cards';
import { PromotionTab } from '@/components/promotions-rules';

/**
 * 营销域三个页面：促销 / 优惠券 / 礼品卡。
 *
 * 拆成独立路由而不是一个页面里的 tab：菜单上能直接看到每一项。
 * 每个页面顶部各有一个功能级总开关，默认关闭；关闭时该功能整体不参与结算。
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

export function MarketingPromotionsPage() {
  return (
    <Page title="促销" description="自动命中的满减与商品折扣，无需顾客输码。">
      <MarketingFeatureSwitch
        feature="promotion"
        title="促销功能"
        description="控制所有自动满减与商品折扣。关闭后即使活动状态为「启用中」也不会命中，历史订单不受影响。默认关闭。"
      />
      <PromotionTab />
    </Page>
  );
}

export function MarketingVouchersPage() {
  return (
    <Page title="优惠券" description="需要顾客输入券码的优惠，支持一券多码与限额。">
      <MarketingFeatureSwitch
        feature="voucher"
        title="优惠券功能"
        description="关闭后店面不再显示券码输入框，已输入的券也不参与结算。默认关闭。"
      />
      <VoucherTab />
    </Page>
  );
}

export function MarketingGiftCardsPage() {
  return (
    <Page title="礼品卡" description="预付卡：创建、绑定、调账与流水。">
      <MarketingFeatureSwitch
        feature="gift_card"
        title="礼品卡功能"
        description="关闭后店面不再显示礼品卡输入框，已有卡不会被抵扣。默认关闭。"
      />
      <GiftCardTab />
    </Page>
  );
}
