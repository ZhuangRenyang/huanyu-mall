import { defineStep, defineWorkflow, StepResponse, type WorkflowRegistry } from "@mall/core";

/** cart-complete 输入：订单载荷 + 行项（仓由后端 inventory 分配，客户端不传）。 */
export interface CartCompleteInput {
  cartId: string;
  email: string;
  /**
   * 下单顾客（登录后才有）。
   *
   * 之前这里根本没有这个字段：顾客登录了，订单也是游客单，
   * 「我的订单」永远查不到东西。归属靠 token 里的 customerId，不信客户端传值。
   */
  customerId?: string | null;
  currencyCode: string;
  channelId: string;
  regionId: string;
  shippingAddress: Record<string, unknown>;
  shippingMinor?: bigint;
  /** 运费税额（ADR-019）：订单税里必须含这一份。 */
  shippingTaxMinor?: bigint;
  /** 订单级折扣总额（行级 + 订单促销，minor unit），服务端算好传入，禁客户端传价（铁律 13）。 */
  discountMinor?: bigint;
  /** 税是否已含在价格里（ADR-018）：true 时订单合计不再加税。 */
  pricesIncludeTax?: boolean;
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
    snapshot: Record<string, unknown>;
    /** 服务端算好的行级税（ADR-018）；快照冻结进订单，后续税率调整不影响历史单。 */
    taxRateBps?: number;
    taxAmountMinor?: bigint;
  }>;
}

export interface OrderPort {
  createOrder(input: CartCompleteInput): Promise<{ orderId: string; totalMinor: bigint }>;
  cancelOrder(orderId: string): Promise<void>;
}
export interface InventoryPort {
  /**
   * 整单分配 + 预留：仓选择只由后端（inventory 模块）决定，客户端与路由不传仓库（铁律 13）。
   * 可跨仓拆单；同一 orderId 幂等。返回全部预留 id（补偿时逐个释放）。
   */
  allocateAndReserve(input: {
    orderId: string;
    items: Array<{ variantId: string; quantity: number }>;
  }): Promise<{ reservationIds: string[] }>;
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
  /** 下单成功时原子扣减礼品卡余额 + 写 used_in_order 流水（余额不足抛错，触发整单回滚）。 */
  consumeGiftCards(entries: Array<{ code: string; amountMinor: bigint }>, orderId: string): Promise<void>;
  /** 补偿：加回余额 + 写 refunded_in_order 流水。 */
  releaseGiftCards(entries: Array<{ code: string; amountMinor: bigint }>, orderId: string): Promise<void>;
}

/** 从折扣留痕明细里提取命中的 voucher 券码（下单成功后要原子核销，防超用）。 */
export function voucherCodesFromDiscounts(
  discounts: CartCompleteInput["discounts"],
): string[] {
  if (!discounts) return [];
  return discounts.filter((d) => d.type === "voucher" && d.code).map((d) => d.code as string);
}

/** 从折扣留痕明细里提取命中的 gift card（卡码 + 抵扣额），下单成功后要原子扣减余额。 */
export function giftCardEntriesFromDiscounts(
  discounts: CartCompleteInput["discounts"],
): Array<{ code: string; amountMinor: bigint }> {
  if (!discounts) return [];
  return discounts
    .filter((d) => d.type === "gift_card" && d.code)
    .map((d) => ({ code: d.code as string, amountMinor: d.amountMinor }));
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
    // 整单一次分配：inventory 模块内部按仓 priority 贪心，可跨仓拆成多条预留
    const { reservationIds } = await inv.allocateAndReserve({
      orderId: input.orderId,
      items: input.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
    });
    return new StepResponse({ reservationIds }, reservationIds);
  },
  async compensate(reservationIds: string[], ctx) {
    const inv = ctx.resolve<InventoryPort>("inventory");
    for (const id of reservationIds) await inv.releaseReservation(id);
  },
});

export const createPaymentCollectionStep = defineStep<
  { orderId: string; amountMinor: bigint; currencyCode: string },
  { paymentCollectionId: string | null },
  string | null
>({
  id: "cart-complete.create-payment-collection",
  compensationClass: "R",
  async invoke(input, ctx) {
    // 抵扣到 0（gift card 全额抵扣）→ 总金额 0，跳过支付集合（payment 侧金额为 0 不发起支付）。
    if (input.amountMinor <= 0n) return new StepResponse({ paymentCollectionId: null }, null);
    const payment = await ctx.resolve<PaymentPort>("payment").createPaymentCollection(input);
    return new StepResponse({ paymentCollectionId: payment.paymentCollectionId }, payment.paymentCollectionId);
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

/**
 * 礼品卡余额扣减（阶段 5）：下单成功后原子扣减余额 + 写 used_in_order 流水。
 * 若并发下余额不足（insufficient），invoke 抛错 → 引擎补偿已成功的 createOrderStep（cancelOrder），
 * 保证「不会收了钱但余额不够扣」（资金安全硬约束 3）。
 * 补偿：加回余额 + 写 refunded_in_order 流水，供后续步骤失败时回滚。
 */
export const consumeGiftCardsStep = defineStep({
  id: "cart-complete.consume-gift-cards",
  compensationClass: "R",
  async invoke(input: { entries: Array<{ code: string; amountMinor: bigint }>; orderId: string }, ctx) {
    if (input.entries.length === 0) return new StepResponse({}, { entries: [], orderId: input.orderId });
    await ctx.resolve<PromotionPort>("promotion").consumeGiftCards(input.entries, input.orderId);
    return new StepResponse({}, { entries: input.entries, orderId: input.orderId });
  },
  async compensate(payload: { entries: Array<{ code: string; amountMinor: bigint }>; orderId: string }, ctx) {
    if (payload.entries.length === 0) return;
    await ctx.resolve<PromotionPort>("promotion").releaseGiftCards(payload.entries, payload.orderId);
  },
});

export const cartCompleteWorkflow = defineWorkflow<CartCompleteInput, { orderId: string }>(
  { id: "cart-complete" },
  async (ctx, input) => {
    const order = await ctx.step(createOrderStep, input);
    await ctx.step(consumeVoucherCodesStep, { codes: voucherCodesFromDiscounts(input.discounts) });
    await ctx.step(consumeGiftCardsStep, {
      entries: giftCardEntriesFromDiscounts(input.discounts),
      orderId: order.orderId,
    });
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
  registry.registerStep(consumeGiftCardsStep);
  registry.registerWorkflow(cartCompleteWorkflow);
}
