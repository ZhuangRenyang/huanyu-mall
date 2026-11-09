import { DomainError } from "@mall/core";

/** 验签失败：provider 内部抛此错，service 捕获后返回 40005（401）且不落库（坑 8）。 */
export class WebhookSignatureError extends Error {
  constructor(message = "webhook signature invalid") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export function webhookVerificationFailed(): DomainError {
  return new DomainError({ code: 40005, message: "回调验签失败" });
}

export function providerNotFound(identifier: string): DomainError {
  return new DomainError({ code: 40001, message: `Payment provider not available: ${identifier}` });
}

export function paymentNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Payment not found: ${id}` });
}

export function sessionNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Payment session not found: ${id}` });
}

export function collectionNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Payment collection not found: ${id}` });
}

export function paymentStateInvalid(id: string, status: string): DomainError {
  return new DomainError({ code: 30002, message: `Payment ${id} is ${status}, operation not allowed` });
}
