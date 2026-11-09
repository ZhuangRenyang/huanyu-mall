import type { DomainEvent } from "./types.js";

const OUTBOX_TABLE = "event_outbox";

export type OutboxSink = (sql: string, params: unknown[]) => Promise<void>;

/** outbox 落库 SQL（event_outbox 表由 M12 event-bus 模块迁移创建）。 */
export function buildOutboxInsert(event: DomainEvent): { sql: string; params: unknown[] } {
  return {
    sql:
      `INSERT INTO ${OUTBOX_TABLE} (id, name, data, occurred_at, correlation_id) ` +
      `VALUES ($1, $2, $3, $4, $5)`,
    params: [event.id, event.name, JSON.stringify(event.data), event.occurredAt, event.correlationId ?? null],
  };
}

/** 事件必须落 outbox（禁 in-memory 直投，架构 §1.2 不变式 5 / §5.7）。 */
export class OutboxWriter {
  constructor(private readonly sink: OutboxSink) {}

  async append(event: DomainEvent): Promise<void> {
    const { sql, params } = buildOutboxInsert(event);
    await this.sink(sql, params);
  }
}
