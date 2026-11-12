/**
 * 顾客账号设置（ADR-025）：注册方式。
 *
 * 只做「二选一」，不做「两种都开」：邮箱注册要密码 + 手机号 + 验证码，
 * 手机号注册只要手机号 + 验证码，两个表单字段完全不同 ——
 * 同时开会让注册页变成四不像，顾客不知道该填哪个。
 *
 * 登录不受这个开关影响：两种方式注册出来的账号都能登录
 * （邮箱注册的账号也能用手机号 + 密码进）。
 */
import { adminClient, getAdminApiMode } from './admin-client';

export type RegisterMode = 'email' | 'phone';

export interface AuthSettingsView {
  registerMode: RegisterMode;
}

export const DEFAULT_AUTH_SETTINGS: AuthSettingsView = { registerMode: 'email' };

const KEY = 'admin:auth-settings';

export async function getAuthSettings(): Promise<AuthSettingsView> {
  if (getAdminApiMode() !== 'live') {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as AuthSettingsView;
    } catch {
      /* 隐私模式：降级成默认值 */
    }
    return DEFAULT_AUTH_SETTINGS;
  }
  const res = (await adminClient().getAuthSettings()) as { register_mode?: RegisterMode };
  return { registerMode: res.register_mode === 'phone' ? 'phone' : 'email' };
}

export async function saveAuthSettings(view: AuthSettingsView): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    try {
      localStorage.setItem(KEY, JSON.stringify(view));
    } catch {
      /* noop */
    }
    return;
  }
  await adminClient().updateAuthSettings({ register_mode: view.registerMode });
}
