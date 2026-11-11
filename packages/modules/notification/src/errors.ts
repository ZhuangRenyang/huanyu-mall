import { DomainError } from "@mall/core";

/** M-notification 模块错误（code 对齐架构 §7.4，通知域占用 31xxx）。 */
export function notificationNotFound(id: string): DomainError {
  return new DomainError({ code: 31001, message: `通知记录不存在：${id}` });
}

export function notificationConfigInvalid(message: string): DomainError {
  return new DomainError({ code: 31002, message: `通知配置无效：${message}` });
}

export function notificationSendFailed(reason: string): DomainError {
  return new DomainError({ code: 31003, message: `邮件发送失败：${reason}` });
}
