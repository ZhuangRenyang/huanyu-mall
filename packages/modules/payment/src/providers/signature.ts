import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";

/** HMAC-SHA256（hex）。 */
export function hmacSha256Hex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Stripe 风格：Stripe-Signature: t=<ts>,v1=<hmac(secret, `${ts}.${body}`)>。 */
export function verifyStripeSignature(secret: string, rawBody: string, header: string): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const idx = kv.indexOf("=");
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  );
  const ts = parts.t;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const expected = hmacSha256Hex(secret, `${ts}.${rawBody}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** RSA-SHA256 签名（APIv3 / RSA2）。 */
export function rsaSha256Sign(privateKeyPem: string, data: string): string {
  return cryptoSign("sha256", Buffer.from(data, "utf8"), privateKeyPem).toString("base64");
}

/** RSA-SHA256 验签。 */
export function rsaSha256Verify(publicKeyPem: string, data: string, signatureBase64: string): boolean {
  try {
    return cryptoVerify("sha256", Buffer.from(data, "utf8"), publicKeyPem, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/** AES-256-GCM 解密（微信 APIv3 resource）。 */
export function decryptAesGcm(
  keyB64: string,
  ivB64: string,
  ciphertextB64: string,
  authTagB64: string,
): string {
  const key = Buffer.from(keyB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(authTagB64, "base64");
  const ct = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** AES-256-GCM 加密（供测试构造回调，生产只解密）。 */
export function encryptAesGcm(
  keyB64: string,
  plaintext: string,
): { ivB64: string; ciphertextB64: string; authTagB64: string } {
  const key = Buffer.from(keyB64, "base64");
  const iv = Buffer.from("0123456789ab", "utf8"); // 12-byte nonce
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ivB64: iv.toString("base64"),
    ciphertextB64: ct.toString("base64"),
    authTagB64: cipher.getAuthTag().toString("base64"),
  };
}

/** 微信 APIv3 resource 解密：apiV3Key 为 32 字节原始串，nonce 为 12 字节，authTag 为密文末 16 字节。 */
export function decryptWechatResource(apiV3Key: string, nonce: string, ciphertextB64: string): string {
  const key = Buffer.from(apiV3Key, "utf8");
  const iv = Buffer.from(nonce, "utf8");
  const data = Buffer.from(ciphertextB64, "base64");
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** 微信 APIv3 resource 加密（供测试构造）。 */
export function encryptWechatResource(apiV3Key: string, nonce: string, plaintext: string): string {
  const key = Buffer.from(apiV3Key, "utf8");
  const iv = Buffer.from(nonce, "utf8");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ct, tag]).toString("base64");
}

/**
 * 支付宝参数原文拼接（按 key 字典序 `k=v&k=v`）。
 *
 * ⚠️ **两种场景的排除规则不同，这是最容易搞混的地方**（实测踩过）：
 *
 * | 场景 | 排除 sign | 排除 sign_type |
 * |---|---|---|
 * | **请求签名**（调用支付宝接口时对我们自己的参数签名） | ✅ 排除 | ❌ **要参与签名** |
 * | **异步通知验签**（验支付宝回调的签名） | ✅ 排除 | ✅ 排除 |
 *
 * 实测证据：用 `alipay.trade.query` 打真网关，签名原文排除 `sign_type`
 * → `40002 / isv.invalid-signature`；包含 `sign_type` → 验签通过（返回业务层错误）。
 * 支付宝在报错信息里回传的「网关生成的验签字符串」里也**带着 sign_type**，是同一件事的旁证。
 *
 * 另外两条通用规则：
 * - **值为空的参数不参与签名**（支付宝回调常带 `buyer_pay_amount=` 这类空值字段，
 *   把空值算进原文会导致永远验签失败，而现象只是「验签失败」，极难联想到空值）
 * - 值**不做** URL 编码（原文里的值就是解码后的原值）
 *
 * @param scope `request` = 请求签名（保留 sign_type）；`notify` = 通知验签（排除 sign_type）。
 *              默认为 `notify`，以保持通知验签调用方行为不变。
 */
export function canonicalizeParams(
  params: Record<string, string>,
  options: { scope?: "request" | "notify" } = {},
): string {
  const isNotify = (options.scope ?? "notify") === "notify";
  return Object.keys(params)
    .filter((k) => k !== "sign")
    .filter((k) => !(isNotify && k === "sign_type"))
    .filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && v !== "";
    })
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}
