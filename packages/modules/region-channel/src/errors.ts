import { DomainError } from "@mall/core";

/** M03 模块错误（DomainError 子类语义，code 对齐架构 §7.4）。 */
export function regionNotFound(): DomainError {
  return new DomainError({ code: 30001, message: "Region not found" });
}

export function channelNotFound(): DomainError {
  return new DomainError({ code: 30001, message: "Channel not found" });
}

export function currencyNotAllowed(channelId: string, currencyCode: string): DomainError {
  return new DomainError({
    code: 20004,
    message: `Currency ${currencyCode} is not allowed for channel ${channelId}`,
  });
}
