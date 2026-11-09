/**
 * DomainError 分类（架构 §7.4 错误码规范）。
 * 分段即语义：1xxxx 认证 / 2xxxx 校验 / 3xxxx 领域状态 / 4xxxx 支付 / 5xxxx 系统 / 6xxxx 限流。
 * `code` 是稳定契约，`message` 可翻译可改。
 */
export class DomainError extends Error {
  readonly code: number;
  readonly details?: unknown;
  override readonly cause?: unknown;
  readonly retryable: boolean;

  constructor(opts: {
    code: number;
    message: string;
    details?: unknown;
    cause?: unknown;
    retryable?: boolean;
  }) {
    super(opts.message);
    this.name = "DomainError";
    this.code = opts.code;
    this.details = opts.details;
    this.cause = opts.cause;
    this.retryable = opts.retryable ?? false;
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}

/** 便捷构造器（code 与 §7.4 对齐）。 */
export const errors = {
  unauthenticated: (message = "未认证") => new DomainError({ code: 10001, message }),
  tokenExpired: (message = "令牌过期") => new DomainError({ code: 10002, message }),
  forbidden: (message = "权限不足") => new DomainError({ code: 10003, message }),
  invalidPublishableKey: (message = "publishable key 无效") =>
    new DomainError({ code: 10004, message }),
  invalidCredentials: (message = "凭证错误") => new DomainError({ code: 10005, message }),
  validation: (message = "参数校验失败", details?: unknown) =>
    new DomainError({ code: 20001, message, details }),
  unknownField: (message = "未知字段") => new DomainError({ code: 20002, message }),
  channelNotFound: (message = "channel 或 locale 不存在") =>
    new DomainError({ code: 20003, message }),
  unsupportedCurrency: (message = "不支持的币种") => new DomainError({ code: 20004, message }),
  notFound: (message = "资源不存在") => new DomainError({ code: 30001, message }),
  invalidState: (message = "状态不允许该操作") => new DomainError({ code: 30002, message }),
  insufficientStock: (message = "库存不足") => new DomainError({ code: 30003, message }),
  priceChanged: (message = "价格已变更需重算") => new DomainError({ code: 30004, message }),
  paymentUnavailable: (message = "支付方式不可用") => new DomainError({ code: 40001, message }),
  paymentDeclined: (message = "支付被拒绝") => new DomainError({ code: 40002, message }),
  webhookSignatureInvalid: (message = "回调验签失败") => new DomainError({ code: 40005, message }),
  internal: (message = "内部错误") => new DomainError({ code: 50001, message }),
  upstreamTimeout: (message = "上游超时") => new DomainError({ code: 50002, message }),
  rateLimited: (message = "触发限流") => new DomainError({ code: 60001, message }),
  idempotencyConflict: (message = "幂等键冲突（同键不同体）") =>
    new DomainError({ code: 60002, message }),
} as const;
