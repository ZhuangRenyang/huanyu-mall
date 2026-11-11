/**
 * 通知域：邮件通知设置 + 通知记录（ADR-016）。
 *
 * 后端字段（snake_case）→ 界面视图模型（camelCase）只在这里发生。
 * 密码不进视图模型：只带 `smtpPasswordSet` 标记，输入框留空表示「保持不变」。
 *
 * mock 模式：localStorage 种子，零依赖可演示；
 * live 模式：真调 Admin API（RBAC requirePermission("settings")）。
 */
import { adminClient, getAdminApiMode } from './admin-client';

export type NotificationTemplate = 'order_confirmation' | 'shipment_notification';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface NotificationSettingsView {
  enabled: boolean;
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPasswordSet: boolean;
  orderConfirmationEnabled: boolean;
  shipmentEnabled: boolean;
  storefrontUrl: string;
}

export interface NotificationView {
  id: string;
  template: NotificationTemplate;
  toEmail: string;
  subject: string;
  status: NotificationStatus;
  attempts: number;
  error: string | null;
  orderId: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface NotificationSettingsPatch {
  enabled?: boolean;
  fromName?: string;
  fromEmail?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  /** 空字符串 = 清除已保存的密码；不传 = 保持不变。 */
  smtpPassword?: string;
  orderConfirmationEnabled?: boolean;
  shipmentEnabled?: boolean;
  storefrontUrl?: string;
}

export const NOTIFICATION_TEMPLATE_LABEL: Record<NotificationTemplate, string> = {
  order_confirmation: '下单确认',
  shipment_notification: '发货通知',
};

const SETTINGS_KEY = 'admin:notification-settings';
const LOG_KEY = 'admin:notification-log';

const DEFAULT_SETTINGS: NotificationSettingsView = {
  enabled: false,
  fromName: '',
  fromEmail: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPasswordSet: false,
  orderConfirmationEnabled: true,
  shipmentEnabled: true,
  storefrontUrl: '',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式下 localStorage 可能不可写；mock 演示不该因此崩掉
  }
}

function mockSeed(): void {
  if (window.localStorage.getItem(LOG_KEY)) return;
  write(LOG_KEY, [
    {
      id: 'ntf_demo1',
      template: 'order_confirmation',
      toEmail: 'buyer@example.com',
      subject: '订单已确认 · A1B2C3D4',
      status: 'sent',
      attempts: 1,
      error: null,
      orderId: 'ord_demo',
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      sentAt: new Date(Date.now() - 3590_000).toISOString(),
    },
    {
      id: 'ntf_demo2',
      template: 'shipment_notification',
      toEmail: 'buyer@example.com',
      subject: '订单 A1B2C3D4 已发货',
      status: 'failed',
      attempts: 3,
      error: 'connect ECONNREFUSED 127.0.0.1:25',
      orderId: 'ord_demo',
      createdAt: new Date(Date.now() - 1800_000).toISOString(),
      sentAt: null,
    },
  ]);
}

function toView(raw: Record<string, unknown>): NotificationView {
  return {
    id: String(raw.id),
    template: raw.template as NotificationTemplate,
    toEmail: String(raw.to_email ?? ''),
    subject: String(raw.subject ?? ''),
    status: raw.status as NotificationStatus,
    attempts: Number(raw.attempts ?? 0),
    error: (raw.error as string | null) ?? null,
    orderId: (raw.order_id as string | null) ?? null,
    createdAt: String(raw.created_at ?? ''),
    sentAt: (raw.sent_at as string | null) ?? null,
  };
}

function settingsToApi(patch: NotificationSettingsPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.fromName !== undefined) body.from_name = patch.fromName;
  if (patch.fromEmail !== undefined) body.from_email = patch.fromEmail;
  if (patch.smtpHost !== undefined) body.smtp_host = patch.smtpHost;
  if (patch.smtpPort !== undefined) body.smtp_port = patch.smtpPort;
  if (patch.smtpSecure !== undefined) body.smtp_secure = patch.smtpSecure;
  if (patch.smtpUser !== undefined) body.smtp_user = patch.smtpUser;
  if (patch.smtpPassword !== undefined) body.smtp_password = patch.smtpPassword;
  if (patch.orderConfirmationEnabled !== undefined) {
    body.order_confirmation_enabled = patch.orderConfirmationEnabled;
  }
  if (patch.shipmentEnabled !== undefined) body.shipment_enabled = patch.shipmentEnabled;
  if (patch.storefrontUrl !== undefined) body.storefront_url = patch.storefrontUrl;
  return body;
}

function settingsFromApi(raw: Record<string, unknown>): NotificationSettingsView {
  return {
    enabled: Boolean(raw.enabled),
    fromName: String(raw.from_name ?? ''),
    fromEmail: String(raw.from_email ?? ''),
    smtpHost: String(raw.smtp_host ?? ''),
    smtpPort: Number(raw.smtp_port ?? 587),
    smtpSecure: Boolean(raw.smtp_secure),
    smtpUser: String(raw.smtp_user ?? ''),
    smtpPasswordSet: Boolean(raw.smtp_password_set),
    orderConfirmationEnabled: raw.order_confirmation_enabled !== false,
    shipmentEnabled: raw.shipment_enabled !== false,
    storefrontUrl: String(raw.storefront_url ?? ''),
  };
}

export async function getNotificationSettings(): Promise<NotificationSettingsView> {
  if (getAdminApiMode() !== 'live') {
    mockSeed();
    return { ...DEFAULT_SETTINGS, ...read<Partial<NotificationSettingsView>>(SETTINGS_KEY, {}) };
  }
  return settingsFromApi((await adminClient().getNotificationSettings()) as Record<string, unknown>);
}

export async function updateNotificationSettings(
  patch: NotificationSettingsPatch,
): Promise<NotificationSettingsView> {
  if (getAdminApiMode() !== 'live') {
    const next = { ...read<Partial<NotificationSettingsView>>(SETTINGS_KEY, {}), ...patch };
    // 密码只留标记，不落明文（与后端一致）
    if (patch.smtpPassword !== undefined) {
      (next as Record<string, unknown>).smtpPasswordSet = patch.smtpPassword.length > 0;
    }
    delete (next as Record<string, unknown>).smtpPassword;
    write(SETTINGS_KEY, next);
    return { ...DEFAULT_SETTINGS, ...next };
  }
  return settingsFromApi(
    (await adminClient().updateNotificationSettings(settingsToApi(patch))) as Record<string, unknown>,
  );
}

export async function sendTestNotification(to: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const settings = await getNotificationSettings();
    if (!settings.smtpHost) throw new Error('邮件发送失败：未填写 SMTP 服务器地址');
    if (!settings.enabled) throw new Error('邮件发送失败：通知功能未开启');
    mockSeed();
    const rows = read<NotificationView[]>(LOG_KEY, []);
    rows.unshift({
      id: `ntf_${Date.now()}`,
      template: 'order_confirmation',
      toEmail: to,
      subject: '【测试】商城邮件通知已就绪',
      status: 'sent',
      attempts: 1,
      error: null,
      orderId: null,
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
    });
    write(LOG_KEY, rows);
    return;
  }
  await adminClient().sendTestNotification(to);
}

export async function listNotifications(): Promise<NotificationView[]> {
  if (getAdminApiMode() !== 'live') {
    mockSeed();
    return read<NotificationView[]>(LOG_KEY, []);
  }
  const res = (await adminClient().listNotifications({ limit: 50 })) as {
    items?: Array<Record<string, unknown>>;
  };
  return (res.items ?? []).map(toView);
}

export async function resendNotification(id: string): Promise<NotificationView> {
  if (getAdminApiMode() !== 'live') {
    mockSeed();
    const rows = read<NotificationView[]>(LOG_KEY, []);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`通知记录不存在：${id}`);
    const settings = await getNotificationSettings();
    row.status = settings.smtpHost ? 'sent' : 'failed';
    row.error = row.status === 'failed' ? 'connect ECONNREFUSED' : null;
    row.attempts += 1;
    row.sentAt = row.status === 'sent' ? new Date().toISOString() : null;
    write(LOG_KEY, rows);
    return row;
  }
  return toView(
    (await adminClient().resendNotification(id)) as Record<string, unknown>,
  );
}
