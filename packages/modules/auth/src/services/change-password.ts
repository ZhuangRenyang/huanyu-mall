import { invalidCredentials, passwordUnchanged, weakPassword } from "../errors.js";
import { checkPasswordStrength } from "./password-policy.js";
import type {
  AuthRepository,
  AuthScope,
  PasswordHasher,
  RefreshTokenDTO,
  TokenBlacklist,
} from "../types.js";

export interface ChangePasswordDeps {
  repo: AuthRepository;
  hasher: PasswordHasher;
  blacklist?: TokenBlacklist;
  /** 该 scope 的 refresh_token 有效期（秒），用于黑名单兜底 TTL。 */
  refreshTtl: (scope: AuthScope) => number;
}

export interface ChangePasswordInput {
  identityId: string;
  currentPassword: string;
  newPassword: string;
}

/**
 * 管理员自助改密。
 *
 * 顺序刻意为「先撤销会话、再覆盖口令」：
 * 撤销失败必须抛错（会话失效是安全底线），而口令覆盖失败时旧口令仍然有效，
 * 用户重新登录后可重试，不会被锁在门外。
 *
 * 改密后不签发新 token，由调用方引导用户重新登录。
 */
export async function changeAdminPassword(
  deps: ChangePasswordDeps,
  input: ChangePasswordInput,
): Promise<{ revokedRefreshTokens: number }> {
  const identity = await deps.repo.findIdentityById(input.identityId);
  if (!identity || identity.scope !== "admin" || identity.status !== "active") {
    throw invalidCredentials();
  }

  const currentHash = await deps.repo.findCredentialHash(identity.id);
  if (!currentHash || !(await deps.hasher.verify(currentHash, input.currentPassword))) {
    throw invalidCredentials();
  }

  const strength = checkPasswordStrength(input.newPassword);
  if (!strength.ok) throw weakPassword(strength.reason ?? "新口令强度不足");

  if (await deps.hasher.verify(currentHash, input.newPassword)) {
    throw passwordUnchanged();
  }

  const revoked = await deps.repo.revokeRefreshTokensByIdentity(identity.id);
  if (deps.blacklist) {
    for (const row of revoked) {
      await deps.blacklist.revoke(row.id, remainingTtl(row, deps.refreshTtl));
    }
  }

  const newHash = await deps.hasher.hash(input.newPassword);
  await deps.repo.updateCredentialHash(identity.id, newHash);
  return { revokedRefreshTokens: revoked.length };
}

/** 剩余有效秒数（黑名单条目不该比 token 本身活得更久）。 */
function remainingTtl(row: RefreshTokenDTO, refreshTtl: (scope: AuthScope) => number): number {
  const remaining = Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000);
  return remaining > 0 ? remaining : refreshTtl(row.scope);
}
