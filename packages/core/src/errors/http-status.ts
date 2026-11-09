import { DomainError } from "./domain-error.js";

/** 错误码 → HTTP 状态码映射（架构 §7.4）。 */
const EXPLICIT_STATUS: Record<number, number> = {
  0: 200,
  10003: 403, // 权限不足
  30001: 404, // 资源不存在
  40005: 401, // 回调验签失败
  50002: 504, // 上游超时
  50003: 502, // 上游返回异常
  60002: 409, // 幂等键冲突
};

/** 区间默认值。 */
const RANGE_STATUS: Record<number, number> = {
  1: 401,
  2: 400,
  3: 409,
  4: 402,
  5: 500,
  6: 429,
};

export function httpStatusFor(code: number): number {
  const explicit = EXPLICIT_STATUS[code];
  if (explicit !== undefined) return explicit;
  const prefix = Math.floor(code / 10000);
  return RANGE_STATUS[prefix] ?? 500;
}

export function httpStatusForError(err: unknown): number {
  if (err instanceof DomainError) return httpStatusFor(err.code);
  return 500;
}
