import { toMinor } from "@mall/core";
import { SandboxPaymentProvider } from "./abstract.js";
import { WebhookSignatureError } from "../errors.js";
import { rsaSha256Verify } from "./signature.js";
import type { WebhookActionResult, WebhookPayload } from "./types.js";

/** PayPal：传输签名（`transmissionId|transmissionTime|webhookId|rawBody` RSA 验签），金额字符串小数 → bigint。 */
export class PaypalPaymentProvider extends SandboxPaymentProvider {
  constructor(config: Record<string, unknown>) {
    super(config, "redirectUrl", "paypal_");
  }

  async getWebhookActionAndData(payload: WebhookPayload): Promise<WebhookActionResult> {
    const publicKeyPem = String(this.config.publicKeyPem ?? "");
    const webhookId = String(this.config.webhookId ?? "");
    const transmissionId = payload.headers["paypal-transmission-id"] ?? "";
    const transmissionTime = payload.headers["paypal-transmission-time"] ?? "";
    const signature = payload.headers["paypal-transmission-sig"] ?? "";
    const canonical = `${transmissionId}|${transmissionTime}|${webhookId}|${payload.rawBody}`;
    if (!publicKeyPem || !rsaSha256Verify(publicKeyPem, canonical, signature)) {
      throw new WebhookSignatureError("paypal signature invalid");
    }

    const body = JSON.parse(payload.rawBody) as {
      id: string;
      event_type: string;
      resource: { id: string; amount?: { value?: string; currency_code?: string } };
    };
    const action =
      body.event_type === "PAYMENT.CAPTURE.COMPLETED"
        ? "captured"
        : body.event_type === "PAYMENT.CAPTURE.DENIED"
          ? "failed"
          : "not_supported";
    const amount = body.resource.amount;
    return {
      eventId: body.id,
      action,
      data: {
        paymentId: body.resource.id,
        reference: body.resource.id,
        amountMinor: amount?.value ? toMinor(amount.value, amount.currency_code ?? "USD") : undefined,
      },
    };
  }
}
