import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** options_encrypted 的 AES-256-GCM 加密（ADR-008）。主密钥来自 ENCRYPTION_KEY（secrets.json）。 */
function masterKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? "dev-insecure-encryption-key-change-me";
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

export function encryptOptions(options: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(options), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptOptions(encrypted: string): Record<string, unknown> {
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as Record<string, unknown>;
}
