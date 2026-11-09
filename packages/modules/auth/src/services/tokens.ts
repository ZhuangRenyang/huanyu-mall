import { createHash, randomBytes } from "node:crypto";

/** 不透明 refresh token（非 JWT），32 字节随机。 */
export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

/** 只存哈希，不存明文。 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
