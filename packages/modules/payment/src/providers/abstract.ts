import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  WebhookActionResult,
  WebhookPayload,
} from "./types.js";

export abstract class AbstractPaymentProvider {
  constructor(protected readonly config: Record<string, unknown>) {}

  abstract initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput>;
  abstract authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput>;
  abstract capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput>;
  abstract refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput>;
  abstract cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput>;
  /** 验签失败必须抛错（service 捕获后 401 且不落库）。 */
  abstract getWebhookActionAndData(payload: WebhookPayload): Promise<WebhookActionResult>;

  // 以下为能力面占位（对账/排障用，一期不实现具体逻辑）
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * 沙箱/仿真基类：initiate 返回客户端拉起上下文，authorize/capture/refund/cancel 返回确定性成功。
 * 四家真实 Provider 与 Fake 都继承它，只重写 getWebhookActionAndData（各自验签算法）。
 */
export abstract class SandboxPaymentProvider extends AbstractPaymentProvider {
  constructor(
    config: Record<string, unknown>,
    private readonly contextKind: "qrcode" | "redirectUrl" | "clientSecret",
    private readonly prefix: string,
  ) {
    super(config);
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const ref = `${this.prefix}${input.sessionId}`;
    const base = { providerReference: ref, raw: { kind: this.contextKind } };
    if (this.contextKind === "qrcode") return { ...base, kind: "qrcode", qrcode: `sandbox://qr/${ref}` };
    if (this.contextKind === "redirectUrl") {
      return { ...base, kind: "redirectUrl", redirectUrl: `https://sandbox.local/pay/${ref}` };
    }
    return { ...base, kind: "clientSecret", clientSecret: `${ref}_secret` };
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return { status: "authorized", providerReference: `${this.prefix}auth_${input.sessionId}` };
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { status: "captured", providerReference: `${this.prefix}cap_${input.paymentId}` };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    return { status: "succeeded", providerReference: `${this.prefix}ref_${input.paymentId}` };
  }

  async cancelPayment(_input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { status: "canceled" };
  }
}

export function isSucceeded(status: string): boolean {
  return status === "authorized" || status === "captured" || status === "succeeded" || status === "canceled";
}
