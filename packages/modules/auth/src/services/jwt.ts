import { createHmac, timingSafeEqual } from "node:crypto";

/** 最小 HS256 JWT（无外部依赖；payload 放 {sub,scope,roles,permissions} + iat/exp）。 */
export function signJwt(payload: Record<string, unknown>, secret: string, expiresInSec: number): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyJwt<T extends Record<string, unknown> = Record<string, unknown>>(
  token: string,
  secret: string,
): (T & { exp?: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let decoded: T & { exp?: number };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T & { exp?: number };
  } catch {
    return null;
  }
  if (decoded.exp !== undefined && decoded.exp < Math.floor(Date.now() / 1000)) return null;
  return decoded;
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}
