/**
 * 口令强度策略 —— 单一来源在 @mall/policy，本文件只做转出。
 *
 * 为什么要转出而不是直接删掉：
 * @mall/auth 对外导出的 checkPasswordStrength / MIN_PASSWORD_LENGTH 已被既有调用方引用，
 * 保留这层转出可以让后端模块结构不变，同时规则本体只有一份（前端 @mall/admin 也引用同一份）。
 * 改规则请改 packages/policy/src/password.ts。
 */
export {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES,
  checkPasswordStrength,
  type PasswordRule,
  type PasswordStrengthResult,
} from "@mall/policy";
