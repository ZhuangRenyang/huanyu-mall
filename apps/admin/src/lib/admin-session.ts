import type { AdminSession } from './admin-data';
import { adminClient, clearTokens, getAdminApiMode, saveTokens, SESSION_KEY } from './admin-client';
import { login as mockLogin, logout as mockLogout } from './admin-store';

/**
 * 后台会话域：登录 / 退出 / 会话态落盘。
 *
 * 单独成文件的原因：会话是唯一会写 localStorage 的域，
 * 与商品/订单/设置的读模型混在一起时，「谁在改登录态」很难一眼看清。
 */

/** 登录结果：失败时带具体中文原因（由调用方直接展示）。 */
export type AdminLoginResult = { ok: true } | { ok: false; error: string };

export async function login(email: string, password: string): Promise<AdminLoginResult> {
  if (getAdminApiMode() !== 'live') return mockLogin(email, password);
  try {
    const res = (await adminClient().login({ email, password })) as {
      access_token: string;
      refresh_token: string;
    };
    saveTokens({ access: res.access_token, refresh: res.refresh_token });
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ email, name: email.split('@')[0], role: 'admin' } satisfies AdminSession),
      );
    } catch {
      /* noop */
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '登录失败' };
  }
}

/**
 * 退出登录：清掉本地令牌与会话态。
 * 改密成功后也走这里 —— 后端已撤销全部 refresh_token，本地更不能留残留。
 */
export function logout(): void {
  if (getAdminApiMode() !== 'live') {
    mockLogout();
    return;
  }
  clearTokens();
}
