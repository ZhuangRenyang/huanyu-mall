import { defineStep, defineWorkflow, StepResponse } from "../types.js";
import type { WorkflowRegistry } from "../registry.js";

/**
 * 示例 workflow：cart-complete 骨架（架构 §5.2）。
 * 后续 Order 模块照此模板写真实流程；step 内只经 ctx.resolve 取其他模块 service，
 * 不 import 其他模块（铁律 1），补偿只依赖 compensateInput（纪律 3）。
 *
 * compensation 分类：R=可逆（createOrder/reserve），X=可对冲（authorizePayment，须置于 R 之后）。
 */

export interface CartCompleteInput {
  cartId: string;
  channelId: string;
}

interface OrderService {
  createOrder(input: { cartId: string; channelId: string }): Promise<{ id: string }>;
  cancelOrder(orderId: string): Promise<void>;
}
interface InventoryService {
  reserve(input: { orderId: string }): Promise<{ reservationId: string }>;
  releaseReservation(reservationId: string): Promise<void>;
}
interface PaymentService {
  authorize(input: { orderId: string }): Promise<{ authorizationId: string }>;
  cancelAuthorization(authorizationId: string): Promise<void>;
}

export const createOrderStep = defineStep({
  id: "cart-complete.create-order",
  compensationClass: "R",
  async invoke(input: CartCompleteInput, ctx) {
    const order = await ctx.resolve<OrderService>("order").createOrder(input);
    return new StepResponse({ orderId: order.id }, order.id);
  },
  async compensate(orderId: string, ctx) {
    await ctx.resolve<OrderService>("order").cancelOrder(orderId);
  },
});

export const reserveInventoryStep = defineStep({
  id: "cart-complete.reserve-inventory",
  compensationClass: "R",
  async invoke(input: { orderId: string }, ctx) {
    const res = await ctx.resolve<InventoryService>("inventory").reserve(input);
    return new StepResponse({ reservationId: res.reservationId }, res.reservationId);
  },
  async compensate(reservationId: string, ctx) {
    await ctx.resolve<InventoryService>("inventory").releaseReservation(reservationId);
  },
});

export const authorizePaymentStep = defineStep({
  id: "cart-complete.authorize-payment",
  compensationClass: "X",
  async invoke(input: { orderId: string }, ctx) {
    const res = await ctx.resolve<PaymentService>("payment").authorize(input);
    return new StepResponse({ authorizationId: res.authorizationId }, res.authorizationId);
  },
  async compensate(authorizationId: string, ctx) {
    await ctx.resolve<PaymentService>("payment").cancelAuthorization(authorizationId);
  },
});

export const cartCompleteWorkflow = defineWorkflow<CartCompleteInput, { orderId: string }>(
  { id: "cart-complete" },
  async (ctx, input) => {
    // 顺序：R → R → X（§5.3 顺序原则：可对冲的资金步骤放在可逆步骤之后）
    const { orderId } = await ctx.step(createOrderStep, input);
    await ctx.step(reserveInventoryStep, { orderId });
    await ctx.step(authorizePaymentStep, { orderId });
    await ctx.emit({ name: "order.placed", data: { orderId } });
    return { orderId };
  },
);

export function registerCartCompleteSteps(registry: WorkflowRegistry): void {
  registry.registerStep(createOrderStep);
  registry.registerStep(reserveInventoryStep);
  registry.registerStep(authorizePaymentStep);
  registry.registerWorkflow(cartCompleteWorkflow);
}
