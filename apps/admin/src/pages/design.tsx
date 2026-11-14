import { Palette } from 'lucide-react';
import { ThemeSettings } from '@/components/settings-theme';

/**
 * 装修（Phase A，ADR-077）。
 *
 * 对齐 CRMEB「设置 → 店铺装修」：装修是决定「店铺长什么样」的地方，
 * 不该混在「店铺资料 / 税务 / 账号」里。
 *
 * 第一阶段只搬主题外观（颜色/字体/圆角/Logo/公告）。
 * 首页模块编排（公告条、轮播、分类、商品列表、券条的开关与顺序）是下一阶段，
 * 这里不放假入口 —— 点进去空白的「页面设计」比没有更坏。
 */
export function DesignPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Palette className="size-5" strokeWidth={2} aria-hidden="true" />
          装修
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          改的是店面的样子：品牌色、字体、圆角、Logo 与公告。保存后店面刷新即生效。
        </p>
      </div>

      <ThemeSettings />

      <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        首页模块编排（公告条 / 轮播 / 分类 / 商品列表 / 券条的开关与顺序）在装修的下一阶段接入。
      </p>
    </div>
  );
}
