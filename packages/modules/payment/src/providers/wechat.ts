import { SandboxPaymentProvider } from "./abstract.js";
import { WebhookSignatureError } from "../errors.js";
import { decryptWechatResource, rsaSha256Verify } from "./signature.js";
import type { WebhookActionResult, WebhookPayload } from "./types.js";

/** 微信支付 APIv3：SHA256-RSA2048 验签 + resource AES-256-GCM 解密。 */
export class WechatPaymentProvider extends SandboxPaymentProvider {
  constructor(config: Record<string, unknown>) {
    super(config, "qrcode", "wechat_");
  }

  async getWebhookActionAndData(payload: WebhookPayload): Promise<WebhookActionResult> {
    const publicKeyPem = String(this.config.platformPublicKeyPem ?? "");
    const apiV3Key = String(this.config.apiV3Key ?? "");
    const ts = payload.headers["wechatpay-timestamp"] ?? "";
    const nonce = payload.headers["wechatpay-nonce"] ?? "";
    const signature = payload.headers["wechatpay-signature"] ?? "";

    if (!publicKeyPem || !rsaSha256Verify(publicKeyPem, `${ts}\n${nonce}\n${payload.rawBody}\n`, signature)) {
      throw new WebhookSignatureError("wechat signature invalid");
    }
    if (!apiV3Key) throw new WebhookSignatureError("wechat apiV3Key missing");

    const body = JSON.parse(payload.rawBody) as {
      id: string;
      event_type: string;
      resource: { ciphertext: string; nonce: string };
    };
    const plain = decryptWechatResource(apiV3Key, body.resource.nonce, body.resource.ciphertext);
    const res = JSON.parse(plain) as {
      out_trade_no: string;
      transaction_id: string;
      trade_state: string;
      amount?: { total?: number };
    };
    const action =
      res.trade_state === "SUCCESS" ? "captured" : res.trade_state === "CLOSED" ? "canceled" : "not_supported";
    return {
      eventId: body.id,
      action,
      data: {
        sessionId: res.out_trade_no,
        paymentId: res.out_trade_no,
        amountMinor: res.amount?.total !== undefined ? BigInt(res.amount.total) : undefined,
        reference: res.transaction_id,
      },
    };
  }
}
