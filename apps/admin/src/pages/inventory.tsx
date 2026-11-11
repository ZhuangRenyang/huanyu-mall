import { ArrowRightLeft, Boxes, Warehouse } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mall/ui';
import { InventoryLevelsTab } from '@/components/inventory-levels';
import { InventoryTransfersTab } from '@/components/inventory-transfers';
import { InventoryLocationsTab } from '@/components/inventory-locations';

/**
 * 库存页：三个分组用 @mall/ui 的 Tabs（与促销页、设置页同范式）。
 *
 * 1. 库存：仓 × SKU 的在库 / 已预留 / 可用（可用量取后端字段，前端不算）。
 * 2. 调拨：仓间搬货的登记与完成/取消（完成时才真正搬货）。
 * 3. 仓库：新建 / 编辑仓库与优先级（大者优先，同优先级老仓优先）。
 */
export function InventoryPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground">库存</h1>

      <Tabs defaultValue="levels" className="gap-0">
        <TabsList aria-label="库存分组">
          <TabsTrigger value="levels">
            <Boxes className="size-4" strokeWidth={2} aria-hidden="true" />
            库存
          </TabsTrigger>
          <TabsTrigger value="transfers">
            <ArrowRightLeft className="size-4" strokeWidth={2} aria-hidden="true" />
            调拨
          </TabsTrigger>
          <TabsTrigger value="locations">
            <Warehouse className="size-4" strokeWidth={2} aria-hidden="true" />
            仓库
          </TabsTrigger>
        </TabsList>

        <TabsContent value="levels">
          <InventoryLevelsTab />
        </TabsContent>

        <TabsContent value="transfers">
          <InventoryTransfersTab />
        </TabsContent>

        <TabsContent value="locations">
          <InventoryLocationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
