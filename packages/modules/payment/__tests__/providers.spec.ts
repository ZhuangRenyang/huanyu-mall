import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { WebhookSignatureError } from "../src/errors.js";
import { AlipayPaymentProvider } from "../src/providers/alipay.js";
import { PaypalPaymentProvider } from "../src/providers/paypal.js";
import { StripePaymentProvider } from "../src/providers/stripe.js";
import { WechatPaymentProvider } from "../src/providers/wechat.js";
import { canonicalizeParams, encryptWechatResource, hmacSha256Hex, rsaSha256Sign } from "../src/providers/signature.js";

function rsaKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

describe("Payment Providers 验签（四家沙箱）", () => {
  it("Stripe HMAC：正确通过 / 篡改抛错", async () => {
    const secret = "whsec_test";
    const provider = new StripePaymentProvider({ webhookSecret: secret });
    const body = JSON.stringify({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", amount: 1000 } },
    });
    const ts = "1700000000";
    const v1 = hmacSha256Hex(secret, `${ts}.${body}`);
    const ok = await provider.getWebhookActionAndData({
      headers: { "stripe-signature": `t=${ts},v1=${v1}` },
      rawBody: body,
    });
    expect(ok.action).toBe("captured");
    expect(ok.data?.amountMinor).toBe(1000n);

    await expect(
      provider.getWebhookActionAndData({ headers: { "stripe-signature": `t=${ts},v1=bad` }, rawBody: body }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("微信 RSA + AES-GCM：正确通过 / 篡改抛错", async () => {
    const { publicKey, privateKey } = rsaKeys();
    // 32 字节，但刻意用低熵串：十六进制假 key 会被 GitHub secret scanning 反复告警
    const apiV3Key = "wechat-test-key-aaaaaaaaaaaaaaaa";
    const nonce = "nonce-12345"; // 12 字节
    const provider = new WechatPaymentProvider({ platformPublicKeyPem: publicKey, apiV3Key });

    const resource = JSON.stringify({
      out_trade_no: "sess_1",
      transaction_id: "wx_txn",
      trade_state: "SUCCESS",
      amount: { total: 1000 },
    });
    const ciphertext = encryptWechatResource(apiV3Key, nonce, resource);
    const body = JSON.stringify({ id: "evt_wx", event_type: "TRANSACTION.SUCCESS", resource: { ciphertext, nonce } });
    const ts = "1700000000";
    const sig = rsaSha256Sign(privateKey, `${ts}\n${nonce}\n${body}\n`);

    const ok = await provider.getWebhookActionAndData({
      headers: { "wechatpay-timestamp": ts, "wechatpay-nonce": nonce, "wechatpay-signature": sig },
      rawBody: body,
    });
    expect(ok.action).toBe("captured");
    expect(ok.eventId).toBe("evt_wx");

    await expect(
      provider.getWebhookActionAndData({
        headers: { "wechatpay-timestamp": ts, "wechatpay-nonce": nonce, "wechatpay-signature": "bad" },
        rawBody: body,
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("支付宝 RSA2：form-encoded 回调验签通过 / 篡改抛错（金额字符串元 → 分）", async () => {
    /*
     * 注意回调是 **application/x-www-form-urlencoded**，不是 JSON。
     * 原实现用 JSON.parse 解析，真实回调根本解析不出来 —— 这条用例现在按真实报文形态构造。
     * 完整的支付宝契约（含空值参数、查单、退款）见 alipay.provider.spec.ts。
     */
    const { publicKey, privateKey } = rsaKeys();
    const provider = new AlipayPaymentProvider({
      appId: "2021000000000001",
      privateKey: rsaKeys().privateKey,
      alipayPublicKey: publicKey,
    });
    const params = {
      out_trade_no: "sess_1",
      trade_no: "ali_txn",
      trade_status: "TRADE_SUCCESS",
      total_amount: "10.00",
    };
    const sign = rsaSha256Sign(privateKey, canonicalizeParams(params));
    const ok = await provider.getWebhookActionAndData({
      headers: {},
      rawBody: new URLSearchParams({ ...params, sign, sign_type: "RSA2" }).toString(),
    });
    expect(ok.action).toBe("captured");
    expect(ok.data?.amountMinor).toBe(1000n);

    await expect(
      provider.getWebhookActionAndData({
        headers: {},
        rawBody: new URLSearchParams({ ...params, sign: "bad", sign_type: "RSA2" }).toString(),
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("PayPal 验签改为调官方 verify API：缺 webhook_id 时一律拒绝", async () => {
    /*
     * 旧实现是本地 RSA 验签（自配 publicKeyPem + 自算 canonical 串）。生产上走不通：
     * PayPal 的签名证书会轮换，本地得自己拉 /v1/notifications/certs 并处理缓存失效，
     * 证书一换回调就会被全量判失败。现改为调官方 `/v1/notifications/verify-webhook-signature`。
     *
     * 本用例只断言安全底线：**没有 webhook_id 就不放行**（宁让 PayPal 重试，
     * 也不接受未验签的回调）。完整验签流程（SUCCESS/FAILURE 判定、事件与金额解析）
     * 见 `paypal.provider.spec.ts`，那里用 mock fetch 覆盖。
     *
     * 注：`rsaSha256Verify` 仍被支付宝（RSA2）与微信（V3 证书签名）使用，工具函数保留。
     */
    const provider = new PaypalPaymentProvider({ clientId: "cid", clientSecret: "sec", mode: "sandbox" });
    await expect(
      provider.getWebhookActionAndData({
        headers: { "paypal-transmission-id": "trans-1" },
        rawBody: JSON.stringify({ id: "evt_pp", event_type: "PAYMENT.CAPTURE.COMPLETED" }),
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});
