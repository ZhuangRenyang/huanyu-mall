import { describe, expect, it } from "vitest";
import { EventBus } from "../src/event/event-bus.js";
import { OutboxRelay } from "../src/event/outbox-relay.js";
import { SubscriberRegistry } from "../src/event/subscriber-registry.js";
import type { DomainEvent } from "../src/event/types.js";

/** 内存版 event_outbox / job_dead_letter，模拟 pg.Pool 行为。 */
class FakeOutboxPool {
  outbox: Array<Record<string, unknown>> = [];
  deadLetters: Array<Record<string, unknown>> = [];

  async query(sql: string, params?: unknown[]) {
    if (sql.includes("INSERT INTO event_outbox")) {
      this.outbox.push({
        id: params?.[0],
        name: params?.[1],
        data: JSON.parse(String(params?.[2])),
        occurred_at: params?.[3],
        correlation_id: params?.[4],
        status: "pending",
        attempts: 0,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM event_outbox")) {
      const pending = this.outbox.filter((r) => r.status === "pending");
      const limit = Number(params?.[0] ?? 20);
      return { rows: pending.slice(0, limit).map((r) => ({ ...r })), rowCount: pending.length };
    }
    if (sql.includes("status = 'processed'")) {
      const r = this.outbox.find((x) => x.id === params?.[0]);
      if (r) r.status = "processed";
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("status = 'dead'")) {
      const r = this.outbox.find((x) => x.id === params?.[2]);
      if (r) {
        r.status = "dead";
        r.attempts = params?.[0];
        r.last_error = params?.[1];
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE event_outbox SET attempts")) {
      const r = this.outbox.find((x) => x.id === params?.[2]);
      if (r) {
        r.attempts = params?.[0];
        r.last_error = params?.[1];
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO job_dead_letter")) {
      this.deadLetters.push({
        id: params?.[0],
        kind: "event",
        ref_id: params?.[1],
        attempts: params?.[4],
      });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe("EventBus 正式版", () => {
  it("publish 落 outbox 并同步分发 subscriber", async () => {
    const pool = new FakeOutboxPool();
    const registry = new SubscriberRegistry();
    const handled: string[] = [];
    registry.register("order.placed", async (e: DomainEvent) => {
      handled.push(e.id);
    });

    const bus = new EventBus({ pool: pool as never, registry });
    await bus.publish({
      id: "evt_1",
      name: "order.placed",
      data: { orderId: "ord_1" },
      occurredAt: "2026-11-08T00:00:00Z",
    });

    expect(pool.outbox).toHaveLength(1);
    expect(pool.outbox[0].name).toBe("order.placed");
    expect(handled).toEqual(["evt_1"]);
  });

  it("OutboxRelay：pending 分发成功 → processed（崩溃恢复兜底）", async () => {
    const pool = new FakeOutboxPool();
    const registry = new SubscriberRegistry();
    const handled: string[] = [];
    registry.register("payment.captured", async (e: DomainEvent) => {
      handled.push(e.id);
    });
    // 预置 pending（模拟 api 进程写库后崩溃，未同步分发）
    pool.outbox.push({
      id: "evt_2",
      name: "payment.captured",
      data: { orderId: "ord_1" },
      occurred_at: "2026-11-08T00:00:00Z",
      status: "pending",
      attempts: 0,
    });

    const relay = new OutboxRelay({ pool: pool as never, registry });
    const res = await relay.pollAndDispatch();
    expect(res.processed).toBe(1);
    expect(handled).toEqual(["evt_2"]);
    expect(pool.outbox[0].status).toBe("processed");
  });

  it("subscriber 反复失败 → attempts 递增 → 超限进死信", async () => {
    const pool = new FakeOutboxPool();
    const registry = new SubscriberRegistry();
    registry.register("boom", async () => {
      throw new Error("always fails");
    });
    pool.outbox.push({
      id: "evt_3",
      name: "boom",
      data: {},
      occurred_at: "2026-11-08T00:00:00Z",
      status: "pending",
      attempts: 0,
    });

    const relay = new OutboxRelay({ pool: pool as never, registry, maxAttempts: 3 });
    await relay.pollAndDispatch();
    await relay.pollAndDispatch();
    await relay.pollAndDispatch();

    expect(pool.outbox[0].status).toBe("dead");
    expect(pool.deadLetters).toHaveLength(1);
    expect(pool.deadLetters[0].kind).toBe("event");
  });
});
