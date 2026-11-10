import { Gift, Tag, TicketPercent } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mall/ui';
import { VoucherTab } from '@/components/promotions-vouchers';
import { GiftCardTab } from '@/components/promotions-gift-cards';
import { PromotionTab } from '@/components/promotions-rules';

/**
 * 促销页：三个分组用 @mall/ui 的 Tabs（Radix 原语），与设置页同范式。
 *
 * 1. 优惠券（voucher）：满减 / 折扣，一券多码，启停 / 限额 / 有效期。
 * 2. 礼品卡（gift card）：创建 / 详情 / 调账 / 流水。
 * 3. 促销（目录 / 订单）：自动命中，规则（条件 + 优惠）可增删，启停即时生效。
 */
export function PromotionsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground">促销</h1>

      <Tabs defaultValue="vouchers" className="gap-0">
        <TabsList aria-label="促销分组">
          <TabsTrigger value="vouchers">
            <TicketPercent className="size-4" strokeWidth={2} aria-hidden="true" />
            优惠券
          </TabsTrigger>
          <TabsTrigger value="gift-cards">
            <Gift className="size-4" strokeWidth={2} aria-hidden="true" />
            礼品卡
          </TabsTrigger>
          <TabsTrigger value="promotions">
            <Tag className="size-4" strokeWidth={2} aria-hidden="true" />
            促销
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vouchers">
          <VoucherTab />
        </TabsContent>

        <TabsContent value="gift-cards">
          <GiftCardTab />
        </TabsContent>

        <TabsContent value="promotions">
          <PromotionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
