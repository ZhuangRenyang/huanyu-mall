import { Percent, ShieldCheck, Store, UserRound, Wrench } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mall/ui';
import { StoreProfileSettings } from '@/components/settings-store';
import { AccountSettings } from '@/components/settings-account';
import { SystemSettings } from '@/components/settings-system';
import { TaxSettings } from '@/components/settings-tax';
import { CustomerAccountSettings } from '@/components/settings-customer-accounts';

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
  // 店名是最基础的店铺身份（谁在卖）
  { id: 'store', label: '店铺', icon: Store, panel: <StoreProfileSettings /> },
  { id: 'tax', label: '税务', icon: Percent, panel: <TaxSettings /> },
  // 顾客注册方式属于「店铺怎么接待顾客」，和税务同级；不是系统参数
  { id: 'customers', label: '顾客账号', icon: UserRound, panel: <CustomerAccountSettings /> },
  { id: 'system', label: '系统', icon: Wrench, panel: <SystemSettings /> },
  { id: 'account', label: '账号安全', icon: ShieldCheck, panel: <AccountSettings /> },
];

export function SettingsPage() {
  /*
   * 设置只剩「店铺怎么卖」：资料、税务、顾客账号、系统参数、账号安全。
   * 装修（长什么样）与应用（接入了什么）已拆到独立入口（ADR-077），
   * 这里保留 ?tab= 深链，旧书签不会失效。
   */
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const active = TABS.some((t) => t.id === requested) ? (requested as string) : 'store';

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground">设置</h1>

      <Tabs
        value={active}
        onValueChange={(next) => setParams({ tab: next }, { replace: true })}
        className="gap-0"
      >
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
