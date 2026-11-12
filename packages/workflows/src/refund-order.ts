import { defineStep, defineWorkflow, StepResponse, type WorkflowRegistry } from "@mall/core";

/**
 * 退款执行工作流（同意退款后真正打款）。
 *
 * 之前后台的「退款」按钮**只把订单标成 refunded，根本没有调支付退款** ——
 * 钱没退，账已经平了。这个 workflow 就是补上那段：先打款，再改订单状态。
 *
 * 顺序不能反：先把订单标成已退款，一旦打款失败，就成了「显示已退款、实际没退」，
 * 比没退更糟。所以第 1 步是不可逆的资金动作，第 2 步才是状态推进。
 */
export interface RefundOrderInput {
  orderId: string;
  refundRequestId: string;
  /** minor unit；用 number 传（workflow state 会被序列化，bigint 过不去）。 */
  amountMinor: number;
  reason: string;
}

interface PaymentRefundPort {
  findPaymentByOrderId(orderId: string): Promise<{ id: string; status: string } | null>;
  refundPayment(input: {
    paymentId: string;
    amountMinor: bigint;
    reason?: string;
    idempotencyKey: string;
  }): Promise<{ id: string; status: string }>;
}

interface OrderRefundPort {
  markRefundSettled(orderId: string, refundRequestId: string): Promise<unknown>;
}

const refundPaymentStep = defineStep({
  id: "refund-order.refund-payment",
  // 资金已出，无法用代码收回 —— 不可逆
  compensationClass: "I",
  async invoke(
    input: { orderId: string; refundRequestId: string; amountMinor: number; reason: string },
    ctx,
  ) {
    const payment = ctx.resolve<PaymentRefundPort>("payment");
    const payable = await payment.findPaymentByOrderId(input.orderId);
    if (!payable) {
      throw new Error(`订单 ${input.orderId} 没有可退款的支付单（可能未支付或走了线下收款）`);
    }
    if (payable.status !== "captured") {
      throw new Error(`支付单 ${payable.id} 当前状态 ${payable.status}，只有已收款的才能退`);
    }
    const refund = await payment.refundPayment({
      paymentId: payable.id,
      amountMinor: BigInt(input.amountMinor),
      reason: input.reason,
      // 幂等键绑定申请单：同一张申请重试不会退第二次
      idempotencyKey: `refund-request:${input.refundRequestId}`,
    });
    if (refund.status !== "succeeded") {
      throw new Error(`退款未成功（状态 ${refund.status}），请到支付渠道核对`);
    }
    return new StepResponse({ refundId: refund.id });
  },
  async compensate() {
    // 不可逆：钱已经退给顾客，不提供补偿动作（由人工对账处理异常）
  },
});

const markOrderRefundedStep = defineStep({
  id: "refund-order.mark-order-refunded",
  compensationClass: "R",
  async invoke(input: { orderId: string; refundRequestId: string }, ctx) {
    const order = ctx.resolve<OrderRefundPort>("order");
    await order.markRefundSettled(input.orderId, input.refundRequestId);
    return new StepResponse({ orderId: input.orderId });
  },
  async compensate() {
    // 订单状态是业务终态，不回滚：钱已退，回滚状态只会制造「已退款又变回待发货」
  },
});

export const refundOrderWorkflow = defineWorkflow<RefundOrderInput, { orderId: string; refundId: string }>(
  { id: "refund-order" },
  async (ctx, input) => {
    const paid = await ctx.step(refundPaymentStep, input);
    await ctx.step(markOrderRefundedStep, {
      orderId: input.orderId,
      refundRequestId: input.refundRequestId,
    });
    return { orderId: input.orderId, refundId: paid.refundId };
  },
);

export function registerRefundOrder(registry: WorkflowRegistry): void {
  registry.registerStep(refundPaymentStep);
  registry.registerStep(markOrderRefundedStep);
  registry.registerWorkflow(refundOrderWorkflow);
}
