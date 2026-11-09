/** Payment Provider 能力位与输入输出（架构 §6.2 / §6.3）。 */

export interface ProviderCapabilities {
  webhook: boolean;
  partialRefund: boolean;
  authorizeThenCapture: boolean;
  qrFlow: boolean;
  redirectFlow: boolean;
}

export interface PaymentProviderDescriptor {
  identifier: string;
  label: string;
  capabilities: ProviderCapabilities;
  supportedCurrencies: string[];
}

export interface InitiatePaymentInput {
  sessionId: string;
  amountMinor: bigint;
  currencyCode: string;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitiatePaymentOutput {
  kind: "qrcode" | "redirectUrl" | "clientSecret";
  qrcode?: string;
  redirectUrl?: string;
  clientSecret?: string;
  providerReference: string;
  raw?: Record<string, unknown>;
}

export interface AuthorizePaymentInput {
  sessionId: string;
  amountMinor: bigint;
  currencyCode: string;
  providerReference?: string;
}

export interface AuthorizePaymentOutput {
  status: "authorized" | "failed" | "requires_more";
  providerReference: string;
  raw?: Record<string, unknown>;
}

export interface CapturePaymentInput {
  paymentId: string;
  amountMinor: bigint;
  currencyCode: string;
  providerReference?: string;
  idempotencyKey: string;
}

export interface CapturePaymentOutput {
  status: "captured" | "failed";
  providerReference: string;
  raw?: Record<string, unknown>;
}

export interface RefundPaymentInput {
  paymentId: string;
  amountMinor: bigint;
  currencyCode: string;
  reason?: string;
  idempotencyKey: string;
  providerReference?: string;
}

export interface RefundPaymentOutput {
  status: "succeeded" | "failed";
  providerReference: string;
  raw?: Record<string, unknown>;
}

export interface CancelPaymentInput {
  paymentId: string;
  providerReference?: string;
}

export interface CancelPaymentOutput {
  status: "canceled" | "failed";
}

export interface WebhookPayload {
  headers: Record<string, string>;
  rawBody: string;
}

export type WebhookAction = "authorized" | "captured" | "failed" | "canceled" | "not_supported";

export interface WebhookActionResult {
  eventId: string;
  action: WebhookAction;
  data?: {
    sessionId?: string;
    paymentId?: string;
    amountMinor?: bigint;
    reference?: string;
    reason?: string;
  };
}
