import { defineStep, defineWorkflow, StepResponse, type WorkflowRegistry } from "@mall/core";

export interface OrderCancelInput {
  orderId: string;
  reservationIds: string[];
}

interface OrderCancelPort {
  cancelOrder(orderId: string): Promise<void>;
}
interface InventoryCancelPort {
  releaseReservation(id: string): Promise<void>;
}

const cancelOrderStep = defineStep({
  id: "order-cancel.cancel-order",
  compensationClass: "R",
  async invoke(input: { orderId: string }, ctx) {
    await ctx.resolve<OrderCancelPort>("order").cancelOrder(input.orderId);
    return new StepResponse({ orderId: input.orderId }, input.orderId);
  },
  async compensate() {
    // 取消为业务终态，补偿幂等空操作
  },
});

const releaseReservationsStep = defineStep({
  id: "order-cancel.release-reservations",
  compensationClass: "R",
  async invoke(input: { reservationIds: string[] }, ctx) {
    const inv = ctx.resolve<InventoryCancelPort>("inventory");
    for (const id of input.reservationIds) await inv.releaseReservation(id);
    return new StepResponse({ released: input.reservationIds.length });
  },
});

export const orderCancelWorkflow = defineWorkflow<OrderCancelInput, { orderId: string }>(
  { id: "order-cancel" },
  async (ctx, input) => {
    await ctx.step(cancelOrderStep, { orderId: input.orderId });
    await ctx.step(releaseReservationsStep, { reservationIds: input.reservationIds });
    return { orderId: input.orderId };
  },
);

export function registerOrderCancel(registry: WorkflowRegistry): void {
  registry.registerStep(cancelOrderStep);
  registry.registerStep(releaseReservationsStep);
  registry.registerWorkflow(orderCancelWorkflow);
}
