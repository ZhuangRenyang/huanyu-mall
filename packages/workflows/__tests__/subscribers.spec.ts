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
