import { useEffect, useState } from 'react';
import { Badge, Button, Switch } from '@mall/ui';
import { TextField, SelectField } from './field';
import {
  getNotificationSettings,
  listNotifications,
  resendNotification,
  sendTestNotification,
  updateNotificationSettings,
  NOTIFICATION_TEMPLATE_LABEL,
  type NotificationSettingsView,
  type NotificationStatus,
  type NotificationView,
} from '@/lib/admin-notifications';

const STATUS_META: Record<NotificationStatus, { label: string; variant: 'success' | 'warning' | 'neutral' | 'destructive' }> = {
  sent: { label: '已发送', variant: 'success' },
  sending: { label: '发送中', variant: 'neutral' },
  pending: { label: '排队中', variant: 'warning' },
  failed: { label: '失败', variant: 'destructive' },
};

/**
 * 邮件通知设置（ADR-016）。
 *
 * 三件事放同一页：开关与 SMTP 配置、测试发送、通知记录与重发。
 * 商家不需要去别处查「到底发出去没有」。
 */
export function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettingsView | null>(null);
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [rows, setRows] = useState<NotificationView[]>([]);
  const [resending, setResending] = useState<string | null>(null);

  const reloadLog = () => {
    void listNotifications()
      .then(setRows)
      .catch(() => setRows([]));
  };

  useEffect(() => {
    void getNotificationSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
    reloadLog();
  }, []);

  const patch = (next: Partial<NotificationSettingsView>) => {
    setSettings((prev) => (prev ? { ...prev, ...next } : prev));
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        enabled: settings.enabled,
        fromName: settings.fromName,
        fromEmail: settings.fromEmail,
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        smtpSecure: settings.smtpSecure,
        smtpUser: settings.smtpUser,
        orderConfirmationEnabled: settings.orderConfirmationEnabled,
        shipmentEnabled: settings.shipmentEnabled,
        storefrontUrl: settings.storefrontUrl,
        // 输入框留空 = 保持原密码不变（与后端约定一致）
        ...(password.length > 0 ? { smtpPassword: password } : {}),
      };
      const after = await updateNotificationSettings(payload);
      setSettings(after);
      setPassword('');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await sendTestNotification(testTo.trim());
      setTestResult('测试邮件已发出，请查收');
      reloadLog();
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : '测试发送失败');
    } finally {
      setTesting(false);
    }
  };

  const runResend = async (id: string) => {
    setResending(id);
    try {
      const after = await resendNotification(id);
      setRows((prev) => prev.map((r) => (r.id === id ? after : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '重发失败');
    } finally {
      setResending(null);
    }
  };

  if (!settings) {
    return <p className="text-sm text-muted-foreground">正在读取通知设置…</p>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">邮件通知</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            交易类邮件：下单确认（付款后发）与发货通知（每张发货单一封）。默认关闭，配好
            SMTP 并打开后才会发信。
          </p>
          {!settings.enabled && (
            <p className="mt-1 text-xs text-warning" role="status">
              当前关闭：顾客不会收到任何邮件。
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{settings.enabled ? '开启' : '关闭'}</span>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(next) => patch({ enabled: next })}
            aria-label={`邮件通知${settings.enabled ? '关闭' : '开启'}`}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">发件与 SMTP</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField
            id="nt-from-name"
            label="发件人名称"
            value={settings.fromName}
            onChange={(e) => patch({ fromName: e.target.value })}
            placeholder="如：我的商城"
          />
          <TextField
            id="nt-from-email"
            label="发件人邮箱"
            type="email"
            value={settings.fromEmail}
            onChange={(e) => patch({ fromEmail: e.target.value })}
            placeholder="noreply@yourshop.com"
          />
          <TextField
            id="nt-host"
            label="SMTP 服务器"
            value={settings.smtpHost}
            onChange={(e) => patch({ smtpHost: e.target.value })}
            placeholder="smtp.example.com"
          />
          <TextField
            id="nt-port"
            label="端口"
            inputMode="numeric"
            value={String(settings.smtpPort)}
            onChange={(e) => patch({ smtpPort: Number(e.target.value.replace(/\D/g, '')) || 0 })}
            placeholder="587"
          />
          <SelectField
            id="nt-secure"
            label="加密方式"
            value={settings.smtpSecure ? 'ssl' : 'starttls'}
            onChange={(e) => patch({ smtpSecure: e.target.value === 'ssl' })}
            options={[
              { value: 'starttls', label: 'STARTTLS（587）' },
              { value: 'ssl', label: 'SSL/TLS（465）' },
            ]}
          />
          <TextField
            id="nt-user"
            label="SMTP 账号"
            value={settings.smtpUser}
            onChange={(e) => patch({ smtpUser: e.target.value })}
            placeholder="留空表示无需认证"
          />
          <TextField
            id="nt-password"
            label="SMTP 密码"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={settings.smtpPasswordSet ? '已保存 · 留空表示不变' : '••••••••'}
            className="sm:col-span-2"
          />
          <TextField
            id="nt-storefront"
            label="店铺地址（邮件里的「查看订单」链接）"
            value={settings.storefrontUrl}
            onChange={(e) => patch({ storefrontUrl: e.target.value })}
            placeholder="https://shop.example.com（可留空）"
            className="sm:col-span-2"
          />
        </div>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={settings.orderConfirmationEnabled}
              onCheckedChange={(next) => patch({ orderConfirmationEnabled: next })}
              aria-label="下单确认邮件"
            />
            下单确认邮件（顾客付款后发）
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={settings.shipmentEnabled}
              onCheckedChange={(next) => patch({ shipmentEnabled: next })}
              aria-label="发货通知邮件"
            />
            发货通知邮件（每次发货发一封，带运单号）
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={settings.stockAlertEnabled}
              onCheckedChange={(next) => patch({ stockAlertEnabled: next })}
              aria-label="到货提醒邮件"
            />
            到货提醒邮件（顾客在售罄商品登记后，补货时发一封）
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={settings.refundEnabled}
              onCheckedChange={(next) => patch({ refundEnabled: next })}
              aria-label="退款进度邮件"
            />
            退款进度邮件（商家同意退货 / 退款到账 / 拒绝时各发一封）
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </Button>
          {saved && (
            <span className="text-xs text-success" role="status">
              已保存
            </span>
          )}
          {error && (
            <span className="text-xs text-destructive" role="alert">
              {error}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">测试发送</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          保存后建议先发一封给自己，确认 SMTP 配置没问题再正式启用。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <TextField
            id="nt-test-to"
            label="收件人"
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@example.com"
            className="min-w-56"
          />
          <Button
            variant="secondary"
            className="self-end"
            onClick={() => void runTest()}
            disabled={testing || !testTo.trim()}
          >
            {testing ? '发送中…' : '发一封测试邮件'}
          </Button>
        </div>
        {testResult && (
          <p
            className={`mt-2 text-xs ${testResult.includes('已发出') ? 'text-success' : 'text-destructive'}`}
            role="status"
          >
            {testResult}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">通知记录</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          最近 50 条。失败的会自动重试 3 次；之后只能在这里手动重发。
        </p>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">暂无记录。</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">类型</th>
                  <th className="py-2 pr-3 font-medium">收件人</th>
                  <th className="py-2 pr-3 font-medium">主题</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = STATUS_META[row.status];
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 tabular text-xs text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="py-2 pr-3">{NOTIFICATION_TEMPLATE_LABEL[row.template]}</td>
                      <td className="py-2 pr-3">{row.toEmail}</td>
                      <td className="max-w-56 truncate py-2 pr-3" title={row.subject}>
                        {row.subject}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {row.status === 'failed' && row.error && (
                          <p className="mt-0.5 max-w-56 truncate text-xs text-destructive" title={row.error}>
                            {row.error}
                          </p>
                        )}
                      </td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={resending === row.id}
                          onClick={() => void runResend(row.id)}
                        >
                          {resending === row.id ? '重发中…' : '重发'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
