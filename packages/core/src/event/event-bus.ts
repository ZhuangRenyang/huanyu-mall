import type { Pool } from "pg";
import { InProcessEventBus } from "./event-emitter.js";
import { OutboxWriter } from "./outbox.js";
import { SubscriberRegistry } from "./subscriber-registry.js";
import type { DomainEvent } from "./types.js";

/**
 * 事件总线（正式版）：publish = 落 outbox（持久化，禁 in-memory 直投）→ in-process 广播 → 同步分发 subscriber。
 * 同步分发是 at-least-once；subscriber 必须幂等。跨进程/崩溃恢复由 OutboxRelay 兜底重投。
 */
export class EventBus {
  private readonly writer: OutboxWriter;
  private readonly inProcess = new InProcessEventBus();

  constructor(
    private readonly deps: { pool: Pool; registry: SubscriberRegistry },
  ) {
    this.writer = new OutboxWriter(async (sql, params) => {
      await deps.pool.query(sql, params);
    });
  }

  async publish(event: DomainEvent): Promise<void> {
    // 1) 持久化到 outbox（先落库，再分发）
    await this.writer.append(event);
    // 2) in-process 广播
    this.inProcess.emit(event);
    // 3) 同步分发到已注册 subscriber
    const handlers = this.deps.registry.get(event.name);
    for (const handler of handlers) {
      await handler(event);
    }
  }

  on(name: string, handler: (event: DomainEvent) => void): this {
    this.inProcess.on(name, handler);
    return this;
  }
}
