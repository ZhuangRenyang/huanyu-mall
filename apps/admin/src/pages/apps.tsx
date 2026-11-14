import { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@mall/ui';
import { getAppsStatus, type AppsStatusView } from '@/lib/admin-apps';
import { PaymentSettings } from '@/components/settings-payments';
import { NotificationSettings } from '@/components/settings-notifications';

/**
 * 应用（Phase A，ADR-077）。
 *
 * 对齐 CRMEB 的「应用」：这里回答「店铺接入了哪些外部能力」，
 * 而不是「店铺怎么卖货」（那是设置）。
 *
 * 第一阶段把支付方式、邮件通知从设置里搬过来；文件存储与渠道目前由部署配置决定，
 * 没有界面开关，所以只说明事实，不放点了没反应的按钮。
 */
export function AppsPage() {
  const [status, setStatus] = useState<AppsStatusView | null>(null);
  useEffect(() => {
    void getAppsStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <LayoutGrid className="size-5" strokeWidth={2} aria-hidden="true" />
          应用
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          店铺接入了哪些外部能力：收款、发信、存文件、渠道。密钥加密存储，界面只显示掩码。
        </p>
      </div>

      {status && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusCard
            label="收款"
            value={`${status.payments.enabled}/${status.payments.total} 家已启用`}
            ok={status.payments.enabled > 0}
            hint={status.payments.enabled > 0 ? '顾客可正常付款' : '还没有启用任何支付通道'}
          />
          <StatusCard
            label="发信"
            value={status.mail.enabled && status.mail.smtpConfigured ? '已配置' : '未配置'}
            ok={status.mail.enabled && status.mail.smtpConfigured}
            hint="下单、发货、退款通知依赖它"
          />
          <StatusCard
            label="存储"
            value="本地磁盘"
            ok
            hint="上传文件存服务器 /uploads，换对象存储属部署配置"
          />
          <StatusCard
            label="渠道"
            value={`${status.channels.active} 个启用`}
            ok={status.channels.active > 0}
            hint={status.channels.currency ? `当前币种 ${status.channels.currency}` : '没有启用中的渠道'}
          />
        </div>
      )}

      <Tabs defaultValue="payments" className="gap-0">
        <TabsList aria-label="应用分组">
          <TabsTrigger value="payments">支付方式</TabsTrigger>
          <TabsTrigger value="notifications">邮件通知</TabsTrigger>
          <TabsTrigger value="others">存储与渠道</TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <PaymentSettings />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>
        <TabsContent value="others">
          <div className="max-w-2xl space-y-3">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">文件存储</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                当前为本地磁盘（上传文件存在服务器 <code className="font-mono text-xs">/uploads</code> 下）。
                换对象存储属于部署配置，不在界面上切换 —— 切错了图片会当场全部 404。
              </p>
            </section>
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">渠道与市场</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                当前为单渠道单币种店铺（默认市场）。多渠道、多币种属于后续阶段，
                现在没有界面开关，避免商家改出一个「商品在别的市场看不到」的配置。
              </p>
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusCard({
  label,
  value,
  ok,
  hint,
}: {
  label: string;
  value: string;
  ok: boolean;
  hint: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Badge variant={ok ? 'success' : 'warning'}>{ok ? '正常' : '待配置'}</Badge>
      </div>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </section>
  );
}
