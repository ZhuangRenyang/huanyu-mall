/**
 * 超时未付款判定（ADR-087）：纯函数，便于单测边界。
 *
 * 只认「未付款」两个状态：已付款的走售后，没人值守不能碰钱。
 */
export const UNPAID_STATUSES = ["pending", "awaiting_payment"] as const;

export function isStaleUnpaid(
  status: string,
  placedAt: string | Date | null | undefined,
  now: Date,
  minutes: number,
): boolean {
  if (!(UNPAID_STATUSES as readonly string[]).includes(status)) return false;
  if (!placedAt) return false;
  const ts = placedAt instanceof Date ? placedAt.getTime() : new Date(placedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts >= minutes * 60_000;
}
