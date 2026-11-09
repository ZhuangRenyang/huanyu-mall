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
    const apiV3Key = "0123456789abcdef0123456789abcdef"; // 32 字节
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

  it("支付宝 RSA2：正确通过 / 篡改抛错（金额字符串元 → 分）", async () => {
    const { publicKey, privateKey } = rsaKeys();
    const provider = new AlipayPaymentProvider({ publicKeyPem: publicKey });
    const params = {
      eventId: "evt_ali",
      out_trade_no: "sess_1",
      trade_no: "ali_txn",
      trade_status: "TRADE_SUCCESS",
      total_amount: "10.00",
    };
    const sign = rsaSha256Sign(privateKey, canonicalizeParams(params));
    const ok = await provider.getWebhookActionAndData({
      headers: {},
      rawBody: JSON.stringify({ ...params, sign }),
    });
    expect(ok.action).toBe("captured");
    expect(ok.data?.amountMinor).toBe(1000n);

    await expect(
      provider.getWebhookActionAndData({ headers: {}, rawBody: JSON.stringify({ ...params, sign: "bad" }) }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("PayPal 传输签名：正确通过 / 篡改抛错", async () => {
    const { publicKey, privateKey } = rsaKeys();
    const webhookId = "wh_1";
    const provider = new PaypalPaymentProvider({ publicKeyPem: publicKey, webhookId });
    const body = JSON.stringify({
      id: "evt_pp",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "cap_1", amount: { value: "10.00", currency_code: "USD" } },
    });
    const tid = "trans-1";
    const ttime = "2026-01-01T00:00:00Z";
    const sig = rsaSha256Sign(privateKey, `${tid}|${ttime}|${webhookId}|${body}`);

    const ok = await provider.getWebhookActionAndData({
      headers: { "paypal-transmission-id": tid, "paypal-transmission-time": ttime, "paypal-transmission-sig": sig },
      rawBody: body,
    });
    expect(ok.action).toBe("captured");
    expect(ok.data?.amountMinor).toBe(1000n);

    await expect(
      provider.getWebhookActionAndData({
        headers: { "paypal-transmission-id": tid, "paypal-transmission-time": ttime, "paypal-transmission-sig": "bad" },
        rawBody: body,
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});
