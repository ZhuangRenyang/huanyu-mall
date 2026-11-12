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

// ---------------------------------------------------------------- *
// 手机号 / 验证码
// ---------------------------------------------------------------- *

export function phoneAlreadyRegistered(phone: string): DomainError {
  return new DomainError({ code: 30002, message: `手机号已注册：${phone}` });
}

/** 验证码不正确（不区分「码错」与「码不存在」，避免被枚举）。 */
export function invalidVerificationCode(): DomainError {
  return new DomainError({ code: 20001, message: "验证码不正确或已失效" });
}

export function verificationCodeExpired(): DomainError {
  return new DomainError({ code: 20001, message: "验证码已过期，请重新获取" });
}

/** 发送太频繁（60 秒一次 / 每日上限）。 */
export function verificationTooFrequent(message: string): DomainError {
  return new DomainError({ code: 60001, message });
}

/** 短信通道未配置：生产环境必须配，不能静默放行。 */
export function smsNotConfigured(): DomainError {
  return new DomainError({ code: 50001, message: "短信通道未配置，请联系商家" });
}

export function invalidPhone(phone: string): DomainError {
  return new DomainError({ code: 20001, message: `手机号格式不正确：${phone}` });
}

/** 邮箱通道未配置：和短信同一口径，宁可不发也不假发。 */
export function emailNotConfigured(): DomainError {
  return new DomainError({ code: 50001, message: "邮件通道未配置，请联系商家" });
}

export function invalidEmail(email: string): DomainError {
  return new DomainError({ code: 20001, message: `邮箱格式不正确：${email}` });
}

/** 店铺当前未开放这种注册方式（服务端守，界面隐藏只是体验）。 */
export function registerModeDisabled(modeLabel: string): DomainError {
  return new DomainError({
    code: 20001,
    message: `本店暂未开放${modeLabel}，请使用其他方式`,
  });
}

export function invalidRegisterMode(): DomainError {
  return new DomainError({ code: 20001, message: "注册方式只能是 email 或 phone" });
}
