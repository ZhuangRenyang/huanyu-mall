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
export interface PromotionPort {
  /** 下单成功时原子核销券码（超限抛错，触发整单回滚）。 */
  consumeVoucherCodes(codes: string[]): Promise<void>;
  /** 补偿：回退一次 used。 */
  releaseVoucherCodes(codes: string[]): Promise<void>;
}

/** 从折扣留痕明细里提取命中的 voucher 券码（下单成功后要原子核销，防超用）。 */
export function voucherCodesFromDiscounts(
  discounts: CartCompleteInput["discounts"],
): string[] {
  if (!discounts) return [];
  return discounts.filter((d) => d.type === "voucher" && d.code).map((d) => d.code as string);
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

/**
 * 券码核销（阶段 4）：下单成功后原子自增 used。若并发下某码超限（exceeded），
 * invoke 抛错 → 引擎补偿已成功的 createOrderStep（cancelOrder），
 * 保证「不会收了钱但券超用了」（资金安全硬约束 3）。
 * 补偿：回退已自增的 used（releaseVoucherCodes），供后续步骤失败时回滚。
 */
export const consumeVoucherCodesStep = defineStep({
  id: "cart-complete.consume-voucher-codes",
  compensationClass: "R",
  async invoke(input: { codes: string[] }, ctx) {
    if (input.codes.length === 0) return new StepResponse({}, []);
    await ctx.resolve<PromotionPort>("promotion").consumeVoucherCodes(input.codes);
    return new StepResponse({}, input.codes);
  },
  async compensate(codes: string[], ctx) {
    if (codes.length === 0) return;
    await ctx.resolve<PromotionPort>("promotion").releaseVoucherCodes(codes);
  },
});

export const cartCompleteWorkflow = defineWorkflow<CartCompleteInput, { orderId: string }>(
  { id: "cart-complete" },
  async (ctx, input) => {
    const order = await ctx.step(createOrderStep, input);
    await ctx.step(consumeVoucherCodesStep, { codes: voucherCodesFromDiscounts(input.discounts) });
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
  registry.registerStep(consumeVoucherCodesStep);
  registry.registerWorkflow(cartCompleteWorkflow);
}
