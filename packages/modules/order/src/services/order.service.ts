import { prefixedUlid } from "@mall/core";
import {
  orderNotFound,
  partialRefundNotSupported,
  refundAlreadyPending,
  refundAlreadyReviewed,
  refundNotAllowed,
  refundRequestNotFound,
  refundResolutionMismatch,
  refundReviewNoteRequired,
  returnShipmentInvalid,
} from "../errors.js";
import { assertTransition, canTransition, isRefundable, supportsReturnRefund } from "./state-machine.js";
import { CUSTOMER_NOTE_MAX_LENGTH } from "../types.js";
import type {
  ActiveRefundDTO,
  Actor,
  CreateOrderInput,
  CustomerOrderSummaryDTO,
  IOrderModuleService,
  OrderDTO,
  OrderLineItemDTO,
  OrderDetailDTO,
  OrderQuery,
  OrderRepository,
  OrderStatus,
  RefundRequestDTO,
  RefundRequestQuery,
  RefundRequestSource,
  RefundResolution,
} from "../types.js";

/**
 * 月销口径的时间窗（ADR-070）。
 *
 * 淘宝商品卡与商品页写「月销 N」，不是累计——三十天前的销量对今天没什么参考价值。
 * 这里只定窗口长度，具体过滤在仓储的 `countSoldByVariantIds({ since })`。
 */
export const MONTHLY_SOLD_DAYS = 30;

/** 月销窗口起点：`now` 往前推 30 天。抽成纯函数便于单测，别在调用处各算一遍。 */
export function monthlySoldSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - MONTHLY_SOLD_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * 顾客留言归一化：空白 → null（不存空串，否则前端要判两种「空」），超长截断。
 *
 * 为什么不抛错：顾客已经点了一次「下单」，为一个备注拦下来，
 * 他要重填地址、重选优惠券，代价远大于截掉几行字。前端另有计数提示。
 */
export function normalizeCustomerNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  return trimmed.length > CUSTOMER_NOTE_MAX_LENGTH
    ? trimmed.slice(0, CUSTOMER_NOTE_MAX_LENGTH)
    : trimmed;
}

/** M05 对外门面（架构 §2.1）。createOrder 冻结行快照，之后 retrieve 不回查目录。 */
export class OrderService implements IOrderModuleService {
  constructor(private readonly repo: OrderRepository) {}

  async createOrder(input: CreateOrderInput): Promise<OrderDetailDTO> {
    const id = prefixedUlid("ord");

    let subtotal = 0n;
    let taxTotal = 0n;
    const lines = input.items.map((item) => {
      const lineTotal = item.unitPriceMinor * BigInt(item.quantity);
      const taxAmount = item.taxAmountMinor ?? 0n;
      subtotal += lineTotal;
      taxTotal += taxAmount;
      return { ...item, totalMinor: lineTotal, taxAmountMinor: taxAmount, taxRateBps: item.taxRateBps ?? 0 };
    });
    const shipping = input.shippingMinor ?? 0n;
    const discount = input.discountMinor ?? 0n;
    // 运费的税也要计入订单税，否则购物车与订单差一份税（真机踩到过）
    const shippingTax = input.shippingTaxMinor ?? 0n;
    const taxMinor = taxTotal + shippingTax;
    // 含税价：税已在行价内，合计不再加；价外税才加（ADR-018，混用即重复收税）
    const total =
      subtotal + shipping - discount + (input.pricesIncludeTax ? 0n : taxMinor);

    await this.repo.insertOrder({
      id,
      cartId: input.cartId ?? null,
      customerId: input.customerId ?? null,
      email: input.email,
      currencyCode: input.currencyCode,
      channelId: input.channelId,
      regionId: input.regionId,
      subtotalMinor: subtotal,
      shippingMinor: shipping,
      taxMinor,
      discountMinor: discount,
      totalMinor: total,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress ?? null,
      paymentCollectionId: input.paymentCollectionId ?? null,
      customerNote: normalizeCustomerNote(input.customerNote),
    });

    const inserted = await this.repo.insertLineItems(
      id,
      lines.map((l) => ({
        variantId: l.variantId,
        productId: l.productId,
        title: l.title,
        sku: l.sku,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        taxRateBps: l.taxRateBps,
        taxAmountMinor: l.taxAmountMinor,
        totalMinor: l.totalMinor,
        currencyCode: input.currencyCode,
        options: l.options ?? null,
      })),
    );

    // 行快照冻结（之后不回查目录）
    await this.repo.insertSnapshots(
      inserted.map((line, i) => ({ orderLineItemId: line.id, snapshot: lines[i]!.snapshot })),
    );

    // 折扣留痕：把命中的促销明细固化进 order_discount（不可变，资金安全硬约束 5）。
    if (input.discounts && input.discounts.length > 0) {
      await this.repo.insertDiscounts(id, input.discounts);
    }

    if (shipping > 0n) {
      await this.repo.insertShippingMethod(id, {
        name: "标准配送",
        amountMinor: shipping,
        currencyCode: input.currencyCode,
      });
    }

    await this.repo.insertStatusHistory(id, null, "pending", "workflow", "order created");
    return this.retrieveOrder(id);
  }

  async setMerchantNote(id: string, note: string | null): Promise<OrderDetailDTO> {
    const trimmed = note?.trim() ?? '';
    const updated = await this.repo.setMerchantNote(id, trimmed === '' ? null : trimmed);
    if (!updated) throw orderNotFound(id);
    return this.retrieveOrder(id);
  }

  async retrieveOrder(id: string): Promise<OrderDetailDTO> {
    const order = await this.repo.findById(id);
    if (!order) throw orderNotFound(id);
    const items = await this.repo.listLineItems(id);
    const shipping = await this.repo.findShippingMethod(id);
    const discounts = await this.repo.listDiscounts(id);
    return { ...order, items, shipping_method: shipping, discounts };
  }

  async listOrders(q: OrderQuery): Promise<{ items: OrderDTO[]; count: number }> {
    return this.repo.list(q);
  }

  async countByStatus(): Promise<Record<string, number>> {
    return this.repo.countByStatus();
  }

  async countSoldByVariants(
    variantIds: string[],
    opts?: { since?: Date },
  ): Promise<Record<string, number>> {
    return this.repo.countSoldByVariantIds(variantIds, opts);
  }

  async summarizePaidSince(
    since: Date,
  ): Promise<{ count: number; amountMinor: bigint; currencyCode: string | null }> {
    return this.repo.summarizePaidSince(since);
  }

  async summarizeByCustomerIds(customerIds: string[]): Promise<CustomerOrderSummaryDTO[]> {
    return this.repo.summarizeByCustomerIds(customerIds);
  }

  /**
   * 列表 + 行项。
   *
   * 店面订单列表要显示「买了什么」，但 OrderDTO 不含行项；逐单 retrieveOrder 就是 N+1。
   * 这里一次批量取回当前页的行项再按订单分组。
   */
  async listOrderSummaries(
    q: OrderQuery,
  ): Promise<{ items: Array<OrderDTO & { items: OrderLineItemDTO[] }>; count: number }> {
    const res = await this.repo.list(q);
    const lines = await this.repo.listLineItemsByOrderIds(res.items.map((o) => o.id));
    const byOrder = new Map<string, OrderLineItemDTO[]>();
    for (const line of lines) {
      const list = byOrder.get(line.order_id) ?? [];
      list.push(line);
      byOrder.set(line.order_id, list);
    }
    return {
      items: res.items.map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] })),
      count: res.count,
    };
  }

  async transition(id: string, to: OrderStatus, meta: { actor: Actor; reason?: string }): Promise<OrderDTO> {
    const order = await this.repo.findById(id);
    if (!order) throw orderNotFound(id);
    // 幂等：同状态重复迁移直接返回（webhook 至少一次投递 + 事件重放需要，§5.6）
    if (order.status === to) return order;
    assertTransition(order.status, to);
    await this.repo.updateStatus(id, to);
    // 订单进入 paid ⟺ 支付成功（order 不依赖 payment，由 payment.captured 事件驱动）
    if (to === "paid") await this.repo.updatePaymentStatus(id, "captured");
    await this.repo.insertStatusHistory(id, order.status, to, meta.actor, meta.reason ?? null);
    const updated = await this.repo.findById(id);
    return updated!;
  }

  /**
   * 创建退款申请单（落库为 pending）。
   *
   * 两个来源共用：买家在店面申请（source=customer）、商家在后台主动退（source=merchant）。
   * 校验三件事：订单可退、金额为全额（一期不支持部分退）、没有待处理申请。
   * 真正打款不在这里做 —— 由 refund-order workflow 在商家同意后执行。
   */
  async createRefundRequest(
    orderId: string,
    input: {
      amountMinor: bigint;
      reason: string;
      source: RefundRequestSource;
      customerId?: string | null;
      resolution?: RefundResolution;
    },
  ): Promise<RefundRequestDTO> {
    const order = await this.repo.findById(orderId);
    if (!order) throw orderNotFound(orderId);
    if (!isRefundable(order.status)) throw refundNotAllowed(`order status ${order.status}`);
    if (input.amountMinor !== order.total_minor) throw partialRefundNotSupported();
    const resolution: RefundResolution = input.resolution ?? "refund_only";
    /*
     * 未发货的订单只能「仅退款」。
     * 让顾客对一个还没出库的订单选「退货退款」，商家同意了会进「等买家寄回」——
     * 买家手里根本没货可寄，单据就永久卡在那里。
     */
    if (resolution === "return_refund" && !supportsReturnRefund(order.status)) {
      throw refundResolutionMismatch(
        `订单当前状态（${order.status}）尚未发货，只能申请仅退款`,
      );
    }
    if (await this.repo.findActiveRefundRequest(orderId)) throw refundAlreadyPending(orderId);

    /*
     * 申请即冻结：订单转「退款中」，商家在此期间不能发货。
     * 淘宝同做法 —— 只把申请放进列表、订单还能发货，等于没拦。
     */
    const request = await this.repo.insertRefundRequest({
      id: prefixedUlid("rfr"),
      orderId,
      customerId: input.customerId ?? order.customer_id,
      amountMinor: input.amountMinor,
      currencyCode: order.currency_code,
      reason: input.reason,
      source: input.source,
      orderStatusBefore: order.status,
      resolution,
    });

    try {
      await this.repo.updateStatus(orderId, "refund_pending");
      await this.repo.insertStatusHistory(
        orderId,
        order.status,
        "refund_pending",
        input.source === "customer" ? "customer" : "admin",
        "refund requested",
      );
    } catch (err) {
      // 状态没冻上就不能留下待处理单据（否则商家会去审一张已不存在的申请）
      await this.repo.updateRefundRequest(request.id, { status: "canceled" });
      throw err;
    }
    return request;
  }

  async listRefundRequests(
    q: RefundRequestQuery,
  ): Promise<{ items: RefundRequestDTO[]; count: number; counts: Record<string, number> }> {
    const [res, counts] = await Promise.all([
      this.repo.listRefundRequests(q),
      this.repo.countRefundRequestsByStatus(),
    ]);
    return { ...res, counts };
  }

  async findRefundRequest(id: string): Promise<RefundRequestDTO | null> {
    return this.repo.findRefundRequest(id);
  }

  /**
   * 批量取活跃售后单（ADR-073）：订单列表一次查询挂出每单的售后进度。
   * 仓储已按订单只留最新一张，这里只做类型收窄，不改口径。
   */
  async listActiveRefundsByOrderIds(orderIds: string[]): Promise<Record<string, ActiveRefundDTO>> {
    const rows = await this.repo.listActiveRefundsByOrderIds(orderIds);
    const out: Record<string, ActiveRefundDTO> = {};
    for (const [orderId, r] of Object.entries(rows)) {
      out[orderId] = {
        id: r.id,
        status: r.status,
        resolution: r.resolution as ActiveRefundDTO["resolution"],
      };
    }
    return out;
  }

  /**
   * 同意退款：workflow 执行打款成功后回写（refund_id 即资金流水）。
   *
   * 订单状态由 workflow 的第 2 步（markRefundSettled）推进为 refunded，
   * 这里只负责单据落定 —— 两边都改会出现「单据已同意、订单没变」的不一致。
   */
  async approveRefundRequest(
    id: string,
    refundId: string,
    reviewNote?: string | null,
  ): Promise<RefundRequestDTO> {
    const req = await this.repo.findRefundRequest(id);
    if (!req) throw refundRequestNotFound(id);
    if (req.status !== "pending") throw refundAlreadyReviewed(req.status);
    /*
     * 只有「仅退款」能走这条直路。
     * 退货退款如果误调这里，等于货还没回来就把钱打了 —— 服务端守住，
     * 不能只靠后台按钮别点错。
     */
    if (req.resolution !== "refund_only") {
      throw refundResolutionMismatch("退货退款不能直接同意打款，需先等买家寄回并确认收货");
    }
    const updated = await this.repo.updateRefundRequest(id, {
      status: "approved",
      refundId,
      reviewNote: reviewNote ?? null,
    });
    return updated!;
  }

  /**
   * 同意「退货退款」：只推进单据，**不动钱**。
   *
   * 淘宝的「同意退货」就是这一步：卖家给出退货地址，等买家寄回。
   *
   * 地址在此时**快照**进单据（ADR-061）：商家之后改店铺地址，
   * 这一单的顾客看到的仍是当初被告知的那个。否则顾客按旧地址寄出、
   * 商家按新地址等货，包裹会在两个地址之间消失。
   */
  async agreeReturnRequest(
    id: string,
    opts?: { reviewNote?: string | null; returnAddress?: string | null },
  ): Promise<RefundRequestDTO> {
    const req = await this.repo.findRefundRequest(id);
    if (!req) throw refundRequestNotFound(id);
    if (req.status !== "pending") throw refundAlreadyReviewed(req.status);
    if (req.resolution !== "return_refund") {
      throw refundResolutionMismatch("该申请是仅退款，应直接同意退款而不是同意退货");
    }
    const updated = await this.repo.updateRefundRequest(id, {
      status: "awaiting_return",
      reviewNote: opts?.reviewNote ?? null,
      // 空串按「没配」存 null：与店铺资料同一口径，前端只需判一种空
      returnAddress: opts?.returnAddress?.trim() ? opts.returnAddress.trim() : null,
    });
    return updated!;
  }

  /**
   * 买家提交退货物流（awaiting_return → returned）。
   *
   * 单号必须真实填写：没有单号，「货已寄出」就是一句话，
   * 商家收到空包裹也无从对账。物流公司与单号都必填。
   */
  async shipReturn(
    id: string,
    input: { carrier: string; trackingNumber: string },
  ): Promise<RefundRequestDTO> {
    const req = await this.repo.findRefundRequest(id);
    if (!req) throw refundRequestNotFound(id);
    if (req.status !== "awaiting_return") {
      throw refundAlreadyReviewed(req.status);
    }
    const carrier = input.carrier?.trim() ?? "";
    const trackingNumber = input.trackingNumber?.trim() ?? "";
    if (carrier === "" || trackingNumber === "") {
      throw returnShipmentInvalid("请填写退货物流公司与单号");
    }
    const updated = await this.repo.setReturnShipment(id, {
      carrier,
      trackingNumber,
      shippedAt: new Date(),
    });
    return updated!;
  }

  /**
   * 商家确认收到退货：退货退款的**唯一打款关卡**。
   *
   * 与仅退款同一顺序：调用方先跑完退款 workflow（钱真的退了），再把 refundId 传进来。
   * 反过来先标 approved，一旦打款失败就成了「单据显示已退款、钱没退」。
   */
  async confirmReturnReceived(
    id: string,
    refundId: string,
    reviewNote?: string | null,
  ): Promise<RefundRequestDTO> {
    const req = await this.repo.findRefundRequest(id);
    if (!req) throw refundRequestNotFound(id);
    if (req.status !== "returned") throw refundAlreadyReviewed(req.status);
    const updated = await this.repo.updateRefundRequest(id, {
      status: "approved",
      refundId,
      reviewNote: reviewNote ?? null,
      returnReceivedAt: new Date(),
    });
    return updated!;
  }

  async rejectRefundRequest(id: string, reviewNote: string): Promise<RefundRequestDTO> {
    const req = await this.repo.findRefundRequest(id);
    if (!req) throw refundRequestNotFound(id);
    /*
     * 只有「待处理」可以拒绝。已经同意退货（awaiting_return）的不能再拒：
     * 买家可能已经把货寄出去了，商家此时反悔，货和钱都在路上。
     * 想反悔只能等买家自己撤销。
     */
    if (req.status !== "pending") throw refundAlreadyReviewed(req.status);
    const note = reviewNote.trim();
    if (note === "") throw refundReviewNoteRequired();
    const updated = await this.repo.updateRefundRequest(id, { status: "rejected", reviewNote: note });
    // 拒绝后订单回到申请前的状态（已发货的回「已发货」，不是一律回待发货）
    await this.restoreOrderAfterRefund(req);
    return updated!;
  }

  async cancelRefundRequest(id: string): Promise<RefundRequestDTO> {
    const req = await this.repo.findRefundRequest(id);
    if (!req) throw refundRequestNotFound(id);
    // 撤销：待处理可以，已同意退货但还没寄回的也可以（买家改主意了）。
    // 已寄回（returned）不允许单方面撤销 —— 货在路上，得商家确认收到后走拒绝。
    if (req.status !== "pending" && req.status !== "awaiting_return") {
      throw refundAlreadyReviewed(req.status);
    }
    const updated = await this.repo.updateRefundRequest(id, { status: "canceled" });
    await this.restoreOrderAfterRefund(req);
    return updated!;
  }

  /**
   * 退款被拒/撤销后恢复订单状态。
   *
   * 只从 refund_pending 回退：若订单已被别的路径推进（手工改状态、支付回调），
   * 盲目写回会覆盖真实状态。没有 order_status_before 的历史单据退回 paid。
   */
  private async restoreOrderAfterRefund(req: RefundRequestDTO): Promise<void> {
    const order = await this.repo.findById(req.order_id);
    if (!order || order.status !== "refund_pending") return;
    const target = req.order_status_before ?? "paid";
    if (!canTransition("refund_pending", target)) return;
    await this.repo.updateStatus(req.order_id, target);
    await this.repo.insertStatusHistory(
      req.order_id,
      "refund_pending",
      target,
      "admin",
      "refund rejected",
    );
  }

  async markRefundSettled(orderId: string, _refundRequestId: string): Promise<OrderDTO> {
    const order = await this.repo.findById(orderId);
    if (!order) throw orderNotFound(orderId);
    assertTransition(order.status, "refunded");
    await this.repo.updateStatus(orderId, "refunded");
    await this.repo.insertStatusHistory(orderId, order.status, "refunded", "workflow", "refund settled");
    const updated = await this.repo.findById(orderId);
    return updated!;
  }

  async cancelOrder(id: string): Promise<void> {
    const order = await this.repo.findById(id);
    if (!order) throw orderNotFound(id);
    if (order.status === "canceled") return; // 幂等：补偿重放
    assertTransition(order.status, "canceled");
    await this.repo.updateStatus(id, "canceled");
    await this.repo.insertStatusHistory(id, order.status, "canceled", "workflow", "compensation cancel");
  }
}
