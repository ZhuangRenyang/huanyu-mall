import { adminClient, getAdminApiMode } from './admin-client';

/** 应用接入状态（ADR-084）：由服务端聚合，前端只展示。 */
export interface AppsStatusView {
  demo: boolean;
  payments: { total: number; enabled: number };
  mail: { enabled: boolean; smtpConfigured: boolean };
  channels: { active: number; currency: string | null };
}

export async function getAppsStatus(): Promise<AppsStatusView> {
  if (getAdminApiMode() !== 'live') {
    return {
      demo: true,
      payments: { total: 4, enabled: 0 },
      mail: { enabled: false, smtpConfigured: false },
      channels: { active: 1, currency: 'CNY' },
    };
  }
  const raw = (await adminClient().getAppsStatus()) as {
    payments?: { total?: number; enabled?: number };
    mail?: { enabled?: boolean; smtp_configured?: boolean };
    channels?: { active?: number; currency?: string | null };
  };
  return {
    demo: false,
    payments: {
      total: Number(raw.payments?.total ?? 0),
      enabled: Number(raw.payments?.enabled ?? 0),
    },
    mail: {
      enabled: raw.mail?.enabled === true,
      smtpConfigured: raw.mail?.smtp_configured === true,
    },
    channels: {
      active: Number(raw.channels?.active ?? 0),
      currency: raw.channels?.currency ?? null,
    },
  };
}
