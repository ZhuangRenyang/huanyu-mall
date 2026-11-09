/**
 * JSON 安全化（纯函数）。
 *
 * 审计快照里可能出现 bigint（金额 int64）、Date、Map 等无法直接 JSON 序列化的值，
 * 直接 JSON.stringify 会抛错，导致审计写入失败。这里统一转成可序列化形态：
 * bigint 转字符串（避免超过 2^53 的金额丢精度），Date 转 ISO 字符串。
 */
export function toJsonSafe(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = toJsonSafe(val);
    return out;
  }
  if (typeof value === "function" || typeof value === "symbol") return null;
  return value;
}
