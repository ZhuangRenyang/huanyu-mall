import { SandboxPaymentProvider } from "./abstract.js";
import { WebhookSignatureError } from "../errors.js";
import { verifyStripeSignature } from "./signature.js";
import type { WebhookActionResult, WebhookPayload } from "./types.js";

/** Stripe：Stripe-Signature(t+v1 HMAC-SHA256) 验签。 */
export class StripePaymentProvider extends SandboxPaymentProvider {
  constructor(config: Record<string, unknown>) {
    super(config, "clientSecret", "stripe_");
  }

  async getWebhookActionAndData(payload: WebhookPayload): Promise<WebhookActionResult> {
    const secret = String(this.config.webhookSecret ?? "");
    const header = payload.headers["stripe-signature"] ?? "";
    if (!secret || !verifyStripeSignature(secret, payload.rawBody, header)) {
      throw new WebhookSignatureError("stripe signature invalid");
    }
    const body = JSON.parse(payload.rawBody) as {
      id: string;
      type: string;
      data: { object: { id: string; amount?: number; metadata?: { sessionId?: string } } };
    };
    const obj = body.data.object;
    const action =
      body.type === "payment_intent.succeeded"
        ? "captured"
        : body.type === "payment_intent.payment_failed"
          ? "failed"
          : body.type === "payment_intent.amount_capturable_updated"
            ? "authorized"
            : "not_supported";
    return {
      eventId: body.id,
      action,
      data: {
        paymentId: obj.id,
        sessionId: obj.metadata?.sessionId,
        amountMinor: obj.amount !== undefined ? BigInt(obj.amount) : undefined,
        reference: obj.id,
      },
    };
  }
}
