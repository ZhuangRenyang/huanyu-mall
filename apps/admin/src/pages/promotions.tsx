import { Gift, Tag, TicketPercent } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mall/ui';
import { VoucherTab } from '@/components/promotions-vouchers';
import { GiftCardTab } from '@/components/promotions-gift-cards';

/**
 * 促销页：三个分组用 @mall/ui 的 Tabs（Radix 原语），与设置页同范式。
 *
 * 1. 优惠券（voucher）：满减 / 折扣，一券多码，启停 / 限额 / 有效期。
 * 2. 礼品卡（gift card）：创建 / 详情 / 调账 / 流水。
 * 3. 促销（目录 / 订单）：后端 admin CRUD 尚未建立，先占位。
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
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <Tag className="mx-auto size-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">促销管理开发中</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              目录促销与订单促销（自动满减 / 折扣）的后台管理接口尚未建立，当前仅支持优惠券与礼品卡。可先通过优惠券覆盖「满减」类需求。
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
