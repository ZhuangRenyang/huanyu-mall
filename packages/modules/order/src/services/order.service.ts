import { prefixedUlid } from "@mall/core";
import { orderNotFound, partialRefundNotSupported, refundNotAllowed } from "../errors.js";
import { assertTransition, isRefundable } from "./state-machine.js";
import type {
  Actor,
  CreateOrderInput,
  IOrderModuleService,
  OrderDTO,
  OrderDetailDTO,
  OrderQuery,
  OrderRepository,
  OrderStatus,
  RefundRequestDTO,
} from "../types.js";

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
    // 含税价：税已在行价内，合计不再加；价外税才加（ADR-018，混用即重复收税）
    const total = subtotal + shipping - discount + (input.pricesIncludeTax ? 0n : taxTotal);

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
      taxMinor: taxTotal,
      discountMinor: discount,
      totalMinor: total,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress ?? null,
      paymentCollectionId: input.paymentCollectionId ?? null,
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

  async createRefundRequest(
    orderId: string,
    input: { amountMinor: bigint; reason: string },
  ): Promise<RefundRequestDTO> {
    const order = await this.repo.findById(orderId);
    if (!order) throw orderNotFound(orderId);
    if (!isRefundable(order.status)) throw refundNotAllowed(`order status ${order.status}`);
    if (input.amountMinor !== order.total_minor) throw partialRefundNotSupported();
    return { orderId, amountMinor: input.amountMinor, currencyCode: order.currency_code, reason: input.reason };
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
