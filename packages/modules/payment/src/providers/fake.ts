import { SandboxPaymentProvider } from "./abstract.js";
import type { WebhookActionResult, WebhookPayload } from "./types.js";

/** 兜底 Provider：内存实现，无商户号也能跑通 建集合→建会话→授权→扣款 闭环。 */
export class FakePaymentProvider extends SandboxPaymentProvider {
  constructor(config: Record<string, unknown> = {}) {
    super(config, "qrcode", "fake_");
  }

  async getWebhookActionAndData(payload: WebhookPayload): Promise<WebhookActionResult> {
    const body = JSON.parse(payload.rawBody) as {
      id: string;
      event: "authorized" | "captured" | "failed" | "canceled";
      sessionId?: string;
      paymentId?: string;
      amountMinor?: number | string;
      reference?: string;
      reason?: string;
    };
    return {
      eventId: body.id,
      action: body.event,
      data: {
        sessionId: body.sessionId,
        paymentId: body.paymentId,
        amountMinor: body.amountMinor !== undefined ? BigInt(body.amountMinor) : undefined,
        reference: body.reference,
        reason: body.reason,
      },
    };
  }
}
