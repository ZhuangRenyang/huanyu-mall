import { toMinor } from "@mall/core";
import { SandboxPaymentProvider } from "./abstract.js";
import { WebhookSignatureError } from "../errors.js";
import { canonicalizeParams, rsaSha256Verify } from "./signature.js";
import type { WebhookActionResult, WebhookPayload } from "./types.js";

/** 支付宝：RSA2 验签（参数按字典序拼接），金额字符串元 → bigint 分（Provider 边界转换）。 */
export class AlipayPaymentProvider extends SandboxPaymentProvider {
  constructor(config: Record<string, unknown>) {
    super(config, "redirectUrl", "alipay_");
  }

  async getWebhookActionAndData(payload: WebhookPayload): Promise<WebhookActionResult> {
    const publicKeyPem = String(this.config.publicKeyPem ?? "");
    const body = JSON.parse(payload.rawBody) as Record<string, string> & {
      eventId: string;
      trade_status: string;
      out_trade_no: string;
      trade_no: string;
      total_amount?: string;
    };
    const canonical = canonicalizeParams(body);
    if (!publicKeyPem || !rsaSha256Verify(publicKeyPem, canonical, body.sign ?? "")) {
      throw new WebhookSignatureError("alipay signature invalid");
    }
    const action =
      body.trade_status === "TRADE_SUCCESS" || body.trade_status === "TRADE_FINISHED"
        ? "captured"
        : body.trade_status === "TRADE_CLOSED"
          ? "canceled"
          : "not_supported";
    return {
      eventId: body.eventId,
      action,
      data: {
        sessionId: body.out_trade_no,
        paymentId: body.out_trade_no,
        amountMinor: body.total_amount ? toMinor(body.total_amount, "CNY") : undefined,
        reference: body.trade_no,
      },
    };
  }
}
