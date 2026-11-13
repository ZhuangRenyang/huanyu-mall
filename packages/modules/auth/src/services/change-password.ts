import { invalidCredentials, passwordUnchanged, weakPassword } from "../errors.js";
import { checkPasswordStrength } from "./password-policy.js";
import { revokeIdentitySessions } from "./session-revoke.js";
import type {
  AuthRepository,
  AuthScope,
  PasswordHasher,
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
 * 自助改密（管理员与顾客共用一套）。
 *
 * 顺序刻意为「先撤销会话、再覆盖口令」：
 * 撤销失败必须抛错（会话失效是安全底线），而口令覆盖失败时旧口令仍然有效，
 * 用户重新登录后可重试，不会被锁在门外。
 *
 * 改密后不签发新 token，由调用方引导用户重新登录。
 *
 * `expectedScope` 是安全边界：顾客身份不能调用管理员改密（反之亦然），
 * 否则拿到顾客 token 就能改同 identityId 下的管理员口令。
 */
async function changePassword(
  deps: ChangePasswordDeps,
  input: ChangePasswordInput,
  expectedScope: AuthScope,
): Promise<{ revokedRefreshTokens: number }> {
  const identity = await deps.repo.findIdentityById(input.identityId);
  if (!identity || identity.scope !== expectedScope || identity.status !== "active") {
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

  const revoked = await revokeIdentitySessions(
    { repo: deps.repo, blacklist: deps.blacklist, refreshTtl: deps.refreshTtl },
    identity.id,
  );

  const newHash = await deps.hasher.hash(input.newPassword);
  await deps.repo.updateCredentialHash(identity.id, newHash);
  return { revokedRefreshTokens: revoked };
}

/** 管理员自助改密。 */
export function changeAdminPassword(
  deps: ChangePasswordDeps,
  input: ChangePasswordInput,
): Promise<{ revokedRefreshTokens: number }> {
  return changePassword(deps, input, "admin");
}

/**
 * 顾客自助改密（ADR-055）。
 *
 * 在此之前顾客想换密码只能走「忘记密码」：收验证码、再重设 ——
 * 一条本来是「密码丢了」才该走的路，被当成了常规操作。
 */
export function changeCustomerPassword(
  deps: ChangePasswordDeps,
  input: ChangePasswordInput,
): Promise<{ revokedRefreshTokens: number }> {
  return changePassword(deps, input, "customer");
}
