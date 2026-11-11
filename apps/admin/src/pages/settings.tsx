import { CreditCard, Mail, Palette, Percent, ShieldCheck, Wrench } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mall/ui';
import { ThemeSettings } from '@/components/settings-theme';
import { PaymentSettings } from '@/components/settings-payments';
import { AccountSettings } from '@/components/settings-account';
import { NotificationSettings } from '@/components/settings-notifications';
import { SystemSettings } from '@/components/settings-system';
import { TaxSettings } from '@/components/settings-tax';

/**
 * 设置页：三个分组用 `@mall/ui` 的 Tabs（Radix 原语）。
 *
 * 迁移说明：原实现是手写 `role="tablist"` + `useState` 切换 + 三元渲染，
 * 只能"看起来像 tab"，缺方向键导航、aria-controls 关联、不可用态语义。
 * 换成 Tabs 后这些由 Radix 提供，页面外观不变（TabsTrigger 的类名与原来逐条对齐）。
 *
 * `className="gap-0"`：原实现的 tablist 与内容之间没有间距，Tabs 默认有 gap-4，
 * 这里显式归零以保持视觉一致。
 */
const TABS = [
  { id: 'theme', label: '外观', icon: Palette, panel: <ThemeSettings /> },
  { id: 'payments', label: '支付方式', icon: CreditCard, panel: <PaymentSettings /> },
  { id: 'notifications', label: '通知', icon: Mail, panel: <NotificationSettings /> },
  { id: 'tax', label: '税务', icon: Percent, panel: <TaxSettings /> },
  { id: 'system', label: '系统', icon: Wrench, panel: <SystemSettings /> },
  { id: 'account', label: '账号安全', icon: ShieldCheck, panel: <AccountSettings /> },
];

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground">设置</h1>

      <Tabs defaultValue="theme" className="gap-0">
        <TabsList aria-label="设置分组">
          {TABS.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id}>
              <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map(({ id, panel }) => (
          <TabsContent key={id} value={id}>
            {panel}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
