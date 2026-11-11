import { describe, expect, it } from "vitest";
import { SubscriberRegistry } from "@mall/core";
import { registerSubscribers } from "../src/subscribers.js";

describe("registerSubscribers（payment.captured → order.transition(paid)）", () => {
  it("payment.captured 触发 order.transition(paid)", async () => {
    const registry = new SubscriberRegistry();
    const transitions: Array<{ id: string; to: string; actor: string }> = [];
    const resolve = (name: string) => {
      if (name === "order") {
        return {
          async transition(id: string, to: string, meta: { actor: string }) {
            transitions.push({ id, to, actor: meta.actor });
          },
        };
      }
      return undefined;
    };

    registerSubscribers(registry, resolve);
    const handlers = registry.get("payment.captured");
    expect(handlers).toHaveLength(1);

    await handlers[0]({
      id: "evt_pay",
      name: "payment.captured",
      data: { orderId: "ord_9" },
      occurredAt: "2026-11-08T00:00:00Z",
    });

    // 状态机 pending → awaiting_payment → paid（两段）
    expect(transitions).toEqual([
      { id: "ord_9", to: "awaiting_payment", actor: "payment-webhook" },
      { id: "ord_9", to: "paid", actor: "payment-webhook" },
    ]);
  });

  it("无 orderId 的事件被安全忽略（幂等/防御）", async () => {
    const registry = new SubscriberRegistry();
    let called = false;
    const resolve = () => ({
      async transition() {
        called = true;
      },
    });
    registerSubscribers(registry, resolve);

    const handlers = registry.get("payment.captured");
    await handlers[0]({
      id: "evt_pay",
      name: "payment.captured",
      data: {},
      occurredAt: "2026-11-08T00:00:00Z",
    });
    expect(called).toBe(false);
  });
});

describe("shipment.created → 订单履约状态推进", () => {
  const baseOrder = {
    id: "ord_ship",
    status: "paid",
    items: [
      { id: "oli_a", quantity: 2 },
      { id: "oli_b", quantity: 1 },
    ],
  };

  function setup(order: unknown, fulfillments: unknown[]) {
    const registry = new SubscriberRegistry();
    const transitions: Array<{ to: string }> = [];
    const resolve = (name: string) => {
      if (name === "order") {
        return {
          retrieveOrder: async () => order,
          transition: async (_id: string, to: string) => {
            transitions.push({ to });
            (order as { status: string }).status = to;
          },
        };
      }
      if (name === "fulfillment") {
        return { listByOrder: async () => fulfillments };
      }
      return undefined;
    };
    registerSubscribers(registry, resolve);
    return { handlers: registry.get("shipment.created"), transitions };
  }

  const evt = {
    id: "evt_ship",
    name: "shipment.created",
    data: { orderId: "ord_ship" },
    occurredAt: "2026-11-11T00:00:00Z",
  };

  it("只发了一个仓 → partially_fulfilled", async () => {
    const { handlers, transitions } = setup(baseOrder, [
      { status: "shipped", items: [{ orderLineItemId: "oli_a", quantity: 2 }] },
      { status: "fulfilled", items: [{ orderLineItemId: "oli_b", quantity: 1 }] },
    ]);
    await handlers[0](evt);
    expect(transitions).toEqual([{ to: "partially_fulfilled" }]);
  });

  it("全部行项发完 → fulfilled", async () => {
    const { handlers, transitions } = setup(
      { ...baseOrder, status: "partially_fulfilled" },
      [
        { status: "shipped", items: [{ orderLineItemId: "oli_a", quantity: 2 }] },
        { status: "shipped", items: [{ orderLineItemId: "oli_b", quantity: 1 }] },
      ],
    );
    await handlers[0](evt);
    expect(transitions).toEqual([{ to: "fulfilled" }]);
  });

  it("建单未填运单不算已发 → 不推进", async () => {
    const { handlers, transitions } = setup(baseOrder, [
      { status: "fulfilled", items: [{ orderLineItemId: "oli_a", quantity: 2 }] },
    ]);
    await handlers[0](evt);
    expect(transitions).toEqual([]);
  });

  it("已取消/已退款订单不动", async () => {
    const { handlers, transitions } = setup(
      { ...baseOrder, status: "refunded" },
      [{ status: "shipped", items: [{ orderLineItemId: "oli_a", quantity: 2 }] }],
    );
    await handlers[0](evt);
    expect(transitions).toEqual([]);
  });
});

describe("事件 → 通知入队（ADR-016：只落库，不发信）", () => {
  const fullOrder = {
    id: "ord_notify",
    status: "paid",
    email: "buyer@example.com",
    currency_code: "CNY",
    subtotal_minor: 19800n,
    shipping_minor: 800n,
    tax_minor: 0n,
    discount_minor: 0n,
    total_minor: 20600n,
    shipping_address: { name: "张三", city: "深圳" },
    items: [
      {
        id: "oli_a",
        title: "无线静音鼠标",
        sku: "MS-BLK",
        quantity: 2,
        unit_price_minor: 9900n,
        total_minor: 19800n,
      },
    ],
  };

  function setup(order: unknown, fulfillments: unknown[], notifyFails = false) {
    const registry = new SubscriberRegistry();
    const transitions: Array<{ to: string }> = [];
    const confirmations: unknown[] = [];
    const shipments: Array<{ fulfillmentId: string; payload: Record<string, unknown> }> = [];
    const resolve = (name: string) => {
      if (name === "order") {
        return {
          retrieveOrder: async () => order,
          transition: async (_id: string, to: string) => {
            transitions.push({ to });
            (order as { status: string }).status = to;
          },
        };
      }
      if (name === "fulfillment") return { listByOrder: async () => fulfillments };
      if (name === "notification") {
        return {
          enqueueOrderConfirmation: async (payload: unknown) => {
            if (notifyFails) throw new Error("DB 挂了");
            confirmations.push(payload);
          },
          enqueueShipmentNotification: async (fulfillmentId: string, payload: unknown) => {
            if (notifyFails) throw new Error("DB 挂了");
            shipments.push({ fulfillmentId, payload: payload as Record<string, unknown> });
          },
        };
      }
      return undefined;
    };
    registerSubscribers(registry, resolve);
    return {
      paymentHandlers: registry.get("payment.captured"),
      shipmentHandlers: registry.get("shipment.created"),
      transitions,
      confirmations,
      shipments,
    };
  }

  const payEvt = {
    id: "evt_p",
    name: "payment.captured",
    data: { orderId: "ord_notify" },
    occurredAt: "2026-11-11T10:00:00Z",
  };

  it("付款后入队下单确认：金额、行数、收件人正确", async () => {
    const { paymentHandlers, confirmations } = setup({ ...fullOrder, status: "awaiting_payment" }, []);
    await paymentHandlers[0](payEvt);
    expect(confirmations).toHaveLength(1);
    const payload = confirmations[0] as Record<string, unknown>;
    expect(payload.orderId).toBe("ord_notify");
    expect(payload.email).toBe("buyer@example.com");
    expect(payload.currencyCode).toBe("CNY");
    expect(payload.subtotalMinor).toBe(19800);
    expect(payload.totalMinor).toBe(20600);
    expect((payload.items as unknown[]).length).toBe(1);
  });

  it("发货后入队发货通知：带承运商与运单号；无运单号不发", async () => {
    const withTracking = [
      {
        id: "fulf_1",
        status: "shipped",
        items: [{ orderLineItemId: "oli_a", quantity: 2 }],
        tracking_links: [{ carrier: "顺丰速运", number: "SF1" }],
      },
    ];
    const a = setup(fullOrder, withTracking);
    await a.shipmentHandlers[0]({
      id: "evt_s1",
      name: "shipment.created",
      data: { orderId: "ord_notify", fulfillmentId: "fulf_1" },
      occurredAt: "2026-11-11T12:00:00Z",
    });
    expect(a.shipments).toHaveLength(1);
    expect(a.shipments[0]!.fulfillmentId).toBe("fulf_1");
    expect(a.shipments[0]!.payload.carrier).toBe("顺丰速运");
    expect(a.shipments[0]!.payload.trackingNumber).toBe("SF1");
    expect((a.shipments[0]!.payload.items as Array<{ title: string }>)[0]!.title).toBe(
      "无线静音鼠标",
    );

    const b = setup(fullOrder, [
      {
        id: "fulf_2",
        status: "fulfilled",
        items: [{ orderLineItemId: "oli_a", quantity: 1 }],
        tracking_links: null,
      },
    ]);
    await b.shipmentHandlers[0]({
      id: "evt_s2",
      name: "shipment.created",
      data: { orderId: "ord_notify", fulfillmentId: "fulf_2" },
      occurredAt: "2026-11-11T12:00:00Z",
    });
    expect(b.shipments).toHaveLength(0);
  });

  it("通知抛错不影响订单状态推进（顺序：先推进，异常被吞）", async () => {
    const { paymentHandlers, transitions } = setup(
      { ...fullOrder, status: "awaiting_payment" },
      [],
      true,
    );
    await expect(paymentHandlers[0](payEvt)).resolves.toBeUndefined();
    expect(transitions.map((t) => t.to)).toEqual(["awaiting_payment", "paid"]);
  });
});
