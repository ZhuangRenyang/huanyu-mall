import { AsyncLocalStorage } from "node:async_hooks";
import { ulid } from "../utils/ulid.js";

const als = new AsyncLocalStorage<string>();

export function newRequestId(): string {
  return ulid();
}

export function getRequestId(): string | undefined {
  return als.getStore();
}

/** 在给定 requestId 上下文中执行，供日志 mixin 透传。 */
export function runWithRequestId<T>(requestId: string | undefined, fn: () => T): T {
  return als.run(requestId ?? ulid(), fn);
}
