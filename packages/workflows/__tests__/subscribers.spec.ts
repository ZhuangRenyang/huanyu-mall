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
