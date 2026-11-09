import { createAdminClient } from '@mall/sdk';

/**
 * 后台 API 客户端底座：模式判定 + 令牌存储 + SDK 客户端实例。
 *
 * 单独成文件的原因：令牌与「会话失效」是所有接口共用的底座，
 * 改密等业务接口要复用它，独立出来才不会让 admin-api.ts 无限膨胀、也避免模块间成环。
 */

/**
 * 后台数据层模式分流：
 * - mock（默认）：走本地 localStorage 种子数据，零依赖可演示
 * - live：走 Admin API（真实后端），token 存本地，401 自动刷新一次
 */
export type AdminApiMode = 'mock' | 'live';

export function getAdminApiMode(): AdminApiMode {
  return import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock';
}

export const TOKEN_KEY = 'admin:tokens';
export const SESSION_KEY = 'admin:session';

export interface StoredTokens {
  access: string;
  refresh: string;
}

let tokens: StoredTokens | null = null;

export function loadTokens(): StoredTokens | null {
  if (tokens) return tokens;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw) tokens = JSON.parse(raw) as StoredTokens;
  } catch {
    tokens = null;
  }
  return tokens;
}

export function saveTokens(next: StoredTokens): void {
  tokens = next;
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
  } catch {
    /* localStorage 不可用 */
  }
}

export function clearTokens(): void {
  tokens = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

/**
 * 会话失效标记：access 过期且 refresh 也换不到新令牌时抛出。
 * 单独建类是为了把它和「网络不可达」区分开 —— 否则用户会看到「网络连接失败」这种误导文案。
 */
export class SessionExpiredError extends Error {
  constructor(message = '登录状态已失效，请重新登录') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/** 浏览器端同源：经 nginx 反代到 /api/v1。 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export function adminClient() {
  const t = loadTokens();
  return createAdminClient({
    baseUrl: API_BASE,
    accessToken: t?.access,
    onRefresh: async () => {
      const cur = loadTokens();
      if (!cur?.refresh) throw new SessionExpiredError();
      const res = await fetch(`${API_BASE}/api/v1/admin/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: cur.refresh }),
      });
      if (!res.ok) {
        clearTokens();
        throw new SessionExpiredError();
      }
      const body = (await res.json()) as { data?: { access_token: string; refresh_token: string } };
      if (!body.data) {
        clearTokens();
        throw new SessionExpiredError();
      }
      saveTokens({ access: body.data.access_token, refresh: body.data.refresh_token });
      return body.data.access_token;
    },
  });
}
