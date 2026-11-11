import { SubscriberRegistry, type DomainEvent } from "@mall/core";
import type {
  OrderConfirmationPayload,
  ShipmentNotificationPayload,
} from "@mall/notification";

/** 订单状态迁移端口（subscriber 侧最小接口，组合根注入真实 order service）。 */
export interface OrderTransitionPort {
  transition(
    orderId: string,
    to: string,
    meta: { actor: string; reason?: string },
  ): Promise<unknown>;
}

/** 订单侧：读订单行与当前状态、推进状态、装配邮件所需字段。 */
export interface OrderShipmentPort {
  retrieveOrder(orderId: string): Promise<{
    id: string;
    status: string;
    email: string;
    currency_code: string;
    subtotal_minor: bigint | number;
    shipping_minor: bigint | number;
    tax_minor: bigint | number;
    discount_minor: bigint | number;
    total_minor: bigint | number;
    shipping_address: Record<string, unknown>;
    items: Array<{
      id: string;
      title: string;
      sku: string;
      quantity: number;
      unit_price_minor: bigint | number;
      total_minor: bigint | number;
    }>;
  }>;
  transition(
    orderId: string,
    to: string,
    meta: { actor: string; reason?: string },
  ): Promise<unknown>;
}

/** 履约侧：按订单读发货单（含行项与运单），用于计算已发数量与发信。 */
export interface FulfillmentListPort {
  listByOrder(orderId: string): Promise<
    Array<{
      id: string;
      status: string;
      items: Array<{ orderLineItemId: string; quantity: number }>;
      tracking_links: Array<{ carrier: string; number: string }> | null;
    }>
  >;
}

/** 通知端口：事件里只负责「入队」，SMTP 发送由派发器异步做（ADR-016）。 */
export interface NotificationPort {
  enqueueOrderConfirmation(payload: OrderConfirmationPayload): Promise<void>;
  enqueueShipmentNotification(
    fulfillmentId: string,
    payload: ShipmentNotificationPayload,
  ): Promise<void>;
}

export interface SubscriberResolve {
  (name: string): unknown;
}

/** 展示单号：取 id 后段大写，邮件里比 ULID 好认。 */
function orderNumber(id: string): string {
  return id.replace(/^ord_/, "").slice(0, 10).toUpperCase();
}

function toConfirmationPayload(
  order: Awaited<ReturnType<OrderShipmentPort["retrieveOrder"]>>,
): OrderConfirmationPayload {
  return {
    orderId: order.id,
    orderNumber: orderNumber(order.id),
    email: order.email,
    currencyCode: order.currency_code,
    items: order.items.map((li) => ({
      title: li.title,
      sku: li.sku,
      quantity: li.quantity,
      unitPriceMinor: Number(li.unit_price_minor),
      totalMinor: Number(li.total_minor),
    })),
    subtotalMinor: Number(order.subtotal_minor),
    shippingMinor: Number(order.shipping_minor),
    taxMinor: Number(order.tax_minor),
    discountMinor: Number(order.discount_minor),
    totalMinor: Number(order.total_minor),
    shippingAddress: order.shipping_address ?? {},
  };
}

/**
 * 注册一期 subscriber（架构 §5.7 / SPEC §12）。
 * - order.placed：占位（一期替代「发邮件」，仅记录）
 * - payment.captured：调 Order.transition(paid)，把支付与订单真正连起来（交易闭环关键一环）
 * subscriber 必须幂等：at-least-once 投递下重复执行无害（transition 有状态机守卫，重复 paid 会被拒绝）。
 */
export function registerSubscribers(
  registry: SubscriberRegistry,
  resolve: SubscriberResolve,
): void {
  registry.register("order.placed", async (event: DomainEvent) => {
    // 刻意不发信：这一刻可能还没付款，「订单已确认」会被顾客当成已付款；
    // 真正的下单确认走 payment.captured（ADR-016 §4）。
    void event;
    void resolve;
  });

  /**
   * 发货 → 订单状态推进（ADR-013 / ADR-015）。
   * 已发数量按订单行汇总：发完 → fulfilled；发了一部分 → partially_fulfilled。
   * 建了发货单但还没填运单的不算已发（status 仍为 fulfilled，不是 shipped）。
   */
  registry.register("shipment.created", async (event: DomainEvent) => {
    const { orderId, fulfillmentId } = event.data as { orderId?: string; fulfillmentId?: string };
    if (!orderId) return;
    const orderSvc = resolve("order") as OrderShipmentPort;
    const fulfillmentSvc = resolve("fulfillment") as FulfillmentListPort;

    const [order, fulfillments] = await Promise.all([
      orderSvc.retrieveOrder(orderId),
      fulfillmentSvc.listByOrder(orderId),
    ]);
    // 只处理已付款 / 部分发货的订单；已取消、已退款等不动。
    if (order.status !== "paid" && order.status !== "partially_fulfilled") return;

    const shippedByLine = new Map<string, number>();
    for (const f of fulfillments) {
      if (f.status !== "shipped" && f.status !== "delivered") continue;
      for (const item of f.items) {
        shippedByLine.set(
          item.orderLineItemId,
          (shippedByLine.get(item.orderLineItemId) ?? 0) + item.quantity,
        );
      }
    }
    if (shippedByLine.size === 0) return;

    const total = order.items.reduce((n, li) => n + li.quantity, 0);
    const done = order.items.reduce(
      (n, li) => n + Math.min(li.quantity, shippedByLine.get(li.id) ?? 0),
      0,
    );
    if (done <= 0) return;

    const to = done >= total ? "fulfilled" : "partially_fulfilled";
    if (order.status !== to) {
      await orderSvc.transition(orderId, to, {
        actor: "fulfillment",
        reason: "shipment created",
      });
    }

    // 发货通知：一张发货单一封（拆单两仓 = 两封）；无运单号的不算「已发货」，不发。
    try {
      const notify = resolve("notification") as NotificationPort | undefined;
      const f = fulfillments.find((x) => x.id === fulfillmentId);
      const tracking = f?.tracking_links?.[0];
      if (notify && f && tracking && fulfillmentId) {
        const titleOf = (lineId: string) =>
          order.items.find((li) => li.id === lineId)?.title ?? lineId;
        await notify.enqueueShipmentNotification(fulfillmentId, {
          orderId,
          orderNumber: orderNumber(order.id),
          email: order.email,
          carrier: tracking.carrier,
          trackingNumber: tracking.number,
          items: f.items.map((it) => ({ title: titleOf(it.orderLineItemId), quantity: it.quantity })),
          shippedAt: event.occurredAt,
        });
      }
    } catch {
      // 同上：通知异常不上抛
    }
  });

  registry.register("payment.captured", async (event: DomainEvent) => {
    const { orderId } = event.data as { orderId?: string };
    if (!orderId) return;
    const order = resolve("order") as OrderTransitionPort;
    const meta = { actor: "payment-webhook", reason: "payment captured" };
    // 状态机 pending → awaiting_payment → paid；两段都走，transition 幂等（重复投递无害）
    await order.transition(orderId, "awaiting_payment", meta);
    await order.transition(orderId, "paid", meta);

    // 下单确认邮件（ADR-016）：只入队不发信；邮件失败绝不影响交易闭环。
    try {
      const notify = resolve("notification") as NotificationPort | undefined;
      const orderReader = resolve("order") as OrderShipmentPort;
      if (notify) {
        await notify.enqueueOrderConfirmation(toConfirmationPayload(await orderReader.retrieveOrder(orderId)));
      }
    } catch {
      // 订阅者是同步跑在请求路径上的：任何通知异常都不允许往上抛
    }
  });
}
