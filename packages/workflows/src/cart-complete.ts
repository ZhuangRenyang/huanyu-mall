import { defineStep, defineWorkflow, StepResponse, type WorkflowRegistry } from "@mall/core";

/** cart-complete 输入：订单载荷 + 预留行（locationId）。 */
export interface CartCompleteInput {
  cartId: string;
  email: string;
  currencyCode: string;
  channelId: string;
  regionId: string;
  shippingAddress: Record<string, unknown>;
  shippingMinor?: bigint;
  /** 订单级折扣总额（行级 + 订单促销，minor unit），服务端算好传入，禁客户端传价（铁律 13）。 */
  discountMinor?: bigint;
  /** 命中的促销折扣明细（供 order 固化 order_discount 留痕）。 */
  discounts?: Array<{
    type: "catalogue" | "order" | "voucher" | "gift_card";
    promotionId: string;
    code: string | null;
    amountMinor: bigint;
  }>;
  items: Array<{
    variantId: string;
    productId: string;
    title: string;
    sku: string;
    quantity: number;
    unitPriceMinor: bigint;
    locationId: string;
    snapshot: Record<string, unknown>;
  }>;
}

export interface OrderPort {
  createOrder(input: CartCompleteInput): Promise<{ orderId: string; totalMinor: bigint }>;
  cancelOrder(orderId: string): Promise<void>;
}
export interface InventoryPort {
  reserve(input: {
    variantId: string;
    locationId: string;
    quantity: number;
    lineItemId: string;
    workflowRunId: string;
    /** 归属订单（发货时按订单找预留转出库）。 */
    orderId?: string;
  }): Promise<{ reservationId: string }>;
  releaseReservation(id: string): Promise<void>;
}
export interface PaymentPort {
  createPaymentCollection(input: {
    orderId: string;
    amountMinor: bigint;
    currencyCode: string;
  }): Promise<{ paymentCollectionId: string }>;
}

export const createOrderStep = defineStep({
  id: "cart-complete.create-order",
  compensationClass: "R",
  async invoke(input: CartCompleteInput, ctx) {
    const order = await ctx.resolve<OrderPort>("order").createOrder(input);
    return new StepResponse(order, order.orderId);
  },
  async compensate(orderId: string, ctx) {
    await ctx.resolve<OrderPort>("order").cancelOrder(orderId);
  },
});

export const reserveInventoryStep = defineStep({
  id: "cart-complete.reserve-inventory",
  compensationClass: "R",
  async invoke(input: { orderId: string; items: CartCompleteInput["items"] }, ctx) {
    const inv = ctx.resolve<InventoryPort>("inventory");
    const reservationIds: string[] = [];
    for (const item of input.items) {
      const r = await inv.reserve({
        variantId: item.variantId,
        locationId: item.locationId,
        quantity: item.quantity,
        lineItemId: `${input.orderId}:${item.variantId}`,
        workflowRunId: input.orderId,
        orderId: input.orderId,
      });
      reservationIds.push(r.reservationId);
    }
    return new StepResponse({ reservationIds }, reservationIds);
  },
  async compensate(reservationIds: string[], ctx) {
    const inv = ctx.resolve<InventoryPort>("inventory");
    for (const id of reservationIds) await inv.releaseReservation(id);
  },
});

export const createPaymentCollectionStep = defineStep({
  id: "cart-complete.create-payment-collection",
  compensationClass: "R",
  async invoke(input: { orderId: string; amountMinor: bigint; currencyCode: string }, ctx) {
    const payment = await ctx.resolve<PaymentPort>("payment").createPaymentCollection(input);
    return new StepResponse(payment, payment.paymentCollectionId);
  },
  async compensate() {
    // 占位：一期支付集合不在本 workflow 删除
  },
});

export const cartCompleteWorkflow = defineWorkflow<CartCompleteInput, { orderId: string }>(
  { id: "cart-complete" },
  async (ctx, input) => {
    const order = await ctx.step(createOrderStep, input);
    await ctx.step(reserveInventoryStep, { orderId: order.orderId, items: input.items });
    await ctx.step(createPaymentCollectionStep, {
      orderId: order.orderId,
      amountMinor: order.totalMinor,
      currencyCode: input.currencyCode,
    });
    await ctx.emit({ name: "order.placed", data: { orderId: order.orderId } });
    return { orderId: order.orderId };
  },
);

export function registerCartComplete(registry: WorkflowRegistry): void {
  registry.registerStep(createOrderStep);
  registry.registerStep(reserveInventoryStep);
  registry.registerStep(createPaymentCollectionStep);
  registry.registerWorkflow(cartCompleteWorkflow);
}
