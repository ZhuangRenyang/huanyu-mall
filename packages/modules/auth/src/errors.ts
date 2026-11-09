import { DomainError } from "@mall/core";

/** M11 模块错误（code 对齐架构 §7.4）。 */
export function invalidCredentials(): DomainError {
  // 不区分邮箱不存在/密码错，统一凭证错误
  return new DomainError({ code: 10005, message: "凭证错误" });
}

export function invalidToken(): DomainError {
  return new DomainError({ code: 10002, message: "令牌无效或已过期" });
}

export function forbidden(permission: string): DomainError {
  return new DomainError({ code: 10003, message: `权限不足：需要 ${permission}` });
}

export function emailAlreadyRegistered(email: string): DomainError {
  return new DomainError({ code: 30002, message: `邮箱已注册：${email}` });
}

/** 口令强度不足（20001 参数校验）。 */
export function weakPassword(reason: string): DomainError {
  return new DomainError({ code: 20001, message: reason });
}

/** 新口令与当前口令相同（20001 参数校验）。 */
export function passwordUnchanged(): DomainError {
  return new DomainError({ code: 20001, message: "新口令不能与当前口令相同" });
}
