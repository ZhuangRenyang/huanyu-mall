import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * SMTP 密码的 AES-256-GCM 加密（ADR-016）。
 * 主密钥复用部署时生成的 ENCRYPTION_KEY（与支付密钥同一约束：轮换后需重填）。
 * 刻意不 import payment 模块的实现——那是两个模块之间的耦合，模块图不该为一段 20 行的
 * 对称加解密加一条边。
 */
function masterKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? "dev-insecure-encryption-key-change-me";
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const body = stored.startsWith("enc:v1:") ? stored.slice("enc:v1:".length) : stored;
  const buf = Buffer.from(body, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
