import { ApiError, type ChangePasswordResponse } from '@mall/sdk';
import { adminClient, getAdminApiMode, SessionExpiredError } from './admin-client';
import { changePassword as mockChangePassword } from './admin-store';

/**
 * 管理员自助改密（live / mock 双分支）。
 *
 * 成功后端会撤销该管理员的全部 refresh_token，且不签发新令牌：
 * 调用方必须清掉本地会话并引导用户重新登录，不能沿用旧 token 继续操作后台。
 */

/** 后端业务错误码（与 packages/core DomainError 对齐）。 */
const CODE_INVALID_CREDENTIALS = 10005;
const CODE_VALIDATION = 20001;
const CODE_RATE_LIMITED = 60001;

/** 业务错误码起点：小于它的都是 HTTP 状态码（SDK 在响应体不是信封时用状态码兜底）。 */
const BUSINESS_CODE_BASE = 10000;

/**
 * 改密失败的分类，界面据此决定错误落在哪个字段、还是整表单提示。
 * - current-password：当前口令不对（10005）
 * - weak-password：新口令强度不足或与旧口令相同（20001）
 * - rate-limited：尝试过于频繁（60001）
 * - session-expired：登录态已失效（access 过期且 refresh 被撤销）
 * - network：网络不可达
 * - service：服务端返回异常状态
 * - unknown：其它业务错误
 */
export type ChangePasswordErrorKind =
  | 'current-password'
  | 'weak-password'
  | 'rate-limited'
  | 'session-expired'
  | 'network'
  | 'service'
  | 'unknown';

export type ChangePasswordResult =
  | { ok: true; revokedRefreshTokens: number; message: string }
  | { ok: false; kind: ChangePasswordErrorKind; message: string };

function kindForCode(code?: number): ChangePasswordErrorKind {
  if (code === CODE_INVALID_CREDENTIALS) return 'current-password';
  if (code === CODE_VALIDATION) return 'weak-password';
  if (code === CODE_RATE_LIMITED) return 'rate-limited';
  return 'unknown';
}

function describeChangePasswordError(err: unknown): { ok: false; kind: ChangePasswordErrorKind; message: string } {
  if (err instanceof SessionExpiredError) {
    return { ok: false, kind: 'session-expired', message: '登录状态已失效，请重新登录后再修改口令' };
  }
  if (err instanceof ApiError) {
    if (err.code === CODE_INVALID_CREDENTIALS) {
      return { ok: false, kind: 'current-password', message: '当前口令不正确，请核对后重新输入' };
    }
    if (err.code === CODE_VALIDATION) {
      // 后端的强度判定原因（如「新口令过短（3 位，至少 8 位）」）原样透传
      return { ok: false, kind: 'weak-password', message: err.message || '新口令不符合强度要求' };
    }
    if (err.code === CODE_RATE_LIMITED) {
      return { ok: false, kind: 'rate-limited', message: err.message || '密码修改尝试过于频繁，请 1 分钟后再试' };
    }
    if (err.code < BUSINESS_CODE_BASE) {
      return { ok: false, kind: 'service', message: `服务端返回异常状态（HTTP ${err.code}），请稍后重试` };
    }
    return { ok: false, kind: 'unknown', message: err.message || '口令修改失败，请稍后重试' };
  }
  // fetch 抛错：断网 / 域名不可达 / CORS 拦截
  return { ok: false, kind: 'network', message: '网络连接失败，请检查网络后重试' };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  if (getAdminApiMode() !== 'live') {
    const res = mockChangePassword(currentPassword, newPassword);
    if (res.ok) {
      return { ok: true, revokedRefreshTokens: 0, message: '密码已修改，请使用新密码重新登录' };
    }
    return { ok: false, kind: kindForCode(res.code), message: res.error ?? '口令修改失败，请稍后重试' };
  }
  try {
    const res = (await adminClient().changePassword({
      current_password: currentPassword,
      new_password: newPassword,
    })) as ChangePasswordResponse;
    return {
      ok: true,
      revokedRefreshTokens: Number(res?.revoked_refresh_tokens ?? 0),
      message: res?.message ?? '密码已修改，请使用新密码重新登录',
    };
  } catch (err) {
    return describeChangePasswordError(err);
  }
}
