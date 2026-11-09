/**
 * 口令强度策略 —— 全项目唯一来源。
 *
 * 前后端共用同一份实现：
 * - 后端 @mall/auth 从这里转出（保持既有导出不变，不破坏任何调用方）
 * - 前端 @mall/admin 直接引用
 * 因此不存在「两份规则悄悄漂移」的可能：改规则只改这一个文件。
 *
 * 纯函数、零运行时依赖：浏览器与 Node 都能直接跑。
 */

/** 最小口令长度。 */
export const MIN_PASSWORD_LENGTH = 8;

/** 单条强度规则：label 用于界面提示，reason 用于失败文案。 */
export interface PasswordRule {
  id: string;
  /** 规则的中文短标签（如「包含数字」），用于强度清单。 */
  label: string;
  /** 是否满足。 */
  test: (value: string) => boolean;
  /** 不满足时的完整中文原因，直接作为错误提示展示。 */
  reason: (value: string) => string;
}

/** 规则顺序 = 判定顺序 = 失败原因优先级：长度 → 字母 → 数字。 */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `至少 ${MIN_PASSWORD_LENGTH} 位`,
    test: (v) => v.length >= MIN_PASSWORD_LENGTH,
    reason: (v) => `新口令过短（${v.length} 位，至少 ${MIN_PASSWORD_LENGTH} 位）`,
  },
  {
    id: 'letter',
    label: '包含字母',
    test: (v) => /[A-Za-z]/.test(v),
    reason: () => '新口令必须包含字母',
  },
  {
    id: 'digit',
    label: '包含数字',
    test: (v) => /[0-9]/.test(v),
    reason: () => '新口令必须包含数字',
  },
];

export interface PasswordStrengthResult {
  ok: boolean;
  /** 不合规原因（具体中文业务语义，直接作为错误提示）。 */
  reason?: string;
}

/**
 * 口令强度判定：按 PASSWORD_RULES 顺序返回第一条不满足规则的原因。
 */
export function checkPasswordStrength(password: string): PasswordStrengthResult {
  for (const rule of PASSWORD_RULES) {
    if (!rule.test(password)) {
      return { ok: false, reason: rule.reason(password) };
    }
  }
  return { ok: true };
}
