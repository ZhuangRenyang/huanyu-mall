import { WorkflowRegistry } from "@mall/core";
import { registerCartComplete } from "./cart-complete.js";
import { registerOrderCancel } from "./order-cancel.js";
import { registerRefundOrder } from "./refund-order.js";

export * from "./cart-complete.js";
export * from "./order-cancel.js";
export * from "./refund-order.js";
export * from "./subscribers.js";

/** 注册全部跨模块 workflow（startup 时调用）。 */
export function createWorkflowRegistry(): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registerCartComplete(registry);
  registerOrderCancel(registry);
  registerRefundOrder(registry);
  return registry;
}
