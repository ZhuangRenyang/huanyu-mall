import type { AuthRepository, AuthScope, RefreshTokenDTO, TokenBlacklist } from "../types.js";

export interface RevokeSessionDeps {
  repo: AuthRepository;
  blacklist?: TokenBlacklist;
  /** 该 scope 的 refresh_token 有效期（秒），用于黑名单兜底 TTL。 */
  refreshTtl: (scope: AuthScope) => number;
}

/**
 * 撤销某身份的全部会话（DB revoked_at 为主事实，黑名单做毫秒级兜底）。
 *
 * 改密和重置密码都要用：密码变了旧会话必须立刻失效，
 * 否则「密码被改」这件事对已经登录的设备毫无影响 —— 那等于没改。
 *
 * 放在独立文件而不是各自实现：两处逻辑一旦分叉，总有一天只有一处撤销干净。
 */
export async function revokeIdentitySessions(
  deps: RevokeSessionDeps,
  identityId: string,
): Promise<number> {
  const revoked = await deps.repo.revokeRefreshTokensByIdentity(identityId);
  if (deps.blacklist) {
    for (const row of revoked) {
      await deps.blacklist.revoke(row.id, remainingTtl(row, deps.refreshTtl));
    }
  }
  return revoked.length;
}

/** 剩余有效秒数（黑名单条目不该比 token 本身活得更久）。 */
export function remainingTtl(
  row: RefreshTokenDTO,
  refreshTtl: (scope: AuthScope) => number,
): number {
  const remaining = Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000);
  return remaining > 0 ? remaining : refreshTtl(row.scope);
}
