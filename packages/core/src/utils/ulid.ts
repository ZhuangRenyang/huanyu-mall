import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID（26 字符，Crockford base32，48bit 时间戳 + 80bit 随机）。 */
export function ulid(now: number = Date.now()): string {
  const buf = Buffer.alloc(16);
  // 48-bit timestamp（ms）
  buf.writeUInt32BE(Math.floor(now / 0x10000), 0);
  buf.writeUInt16BE(now & 0xffff, 4);
  // 80-bit randomness
  randomBytes(10).copy(buf, 6);
  return encodeBase32(buf);
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: unknown): value is string {
  return typeof value === "string" && ULID_RE.test(value);
}

/** `<prefix>_<ulid>` 实体 id。 */
export function prefixedUlid(prefix: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(prefix)) {
    throw new Error(`Invalid id prefix: ${prefix}`);
  }
  return `${prefix}_${ulid()}`;
}

function encodeBase32(buf: Buffer): string {
  let out = "";
  let carry = 0;
  let bits = 0;
  for (const byte of buf) {
    carry = (carry << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(carry >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += ALPHABET[(carry << (5 - bits)) & 0x1f];
  return out;
}
