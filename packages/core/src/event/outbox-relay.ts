import type { Pool } from "pg";
import { SubscriberRegistry } from "./subscriber-registry.js";
import type { DomainEvent } from "./types.js";

export interface RelayResult {
  processed: number;
  failed: number;
  deadLettered: number;
}

/**
 * outbox 中继：worker 轮询 pending 事件 → 分发 subscriber → 标记 processed / 重试 / 死信。
 * at-least-once + SKIP LOCKED 并发安全；subscriber 幂等，重复投递无害。
 */
export class OutboxRelay {
  constructor(
    private readonly deps: {
      pool: Pool;
      registry: SubscriberRegistry;
      maxAttempts?: number;
    },
  ) {}

  async pollAndDispatch(limit = 20): Promise<RelayResult> {
    const maxAttempts = this.deps.maxAttempts ?? 3;
    const { rows } = await this.deps.pool.query(
      `SELECT id, name, data, occurred_at, correlation_id, attempts
         FROM event_outbox
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );

    let processed = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const row of rows) {
      const event: DomainEvent = {
        id: row.id,
        name: row.name,
        data: row.data,
        occurredAt:
          row.occurred_at instanceof Date
            ? row.occurred_at.toISOString()
            : String(row.occurred_at),
        correlationId: row.correlation_id ?? undefined,
      };

      const handlers = this.deps.registry.get(event.name);
      let error: unknown = null;
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (err) {
          error = err;
          break;
        }
      }

      if (error === null) {
        await this.deps.pool.query(
          `UPDATE event_outbox SET status = 'processed', processed_at = now() WHERE id = $1`,
          [row.id],
        );
        processed++;
        continue;
      }

      const attempts = (row.attempts ?? 0) + 1;
      const msg = error instanceof Error ? error.message : String(error);
      if (attempts >= maxAttempts) {
        await this.deps.pool.query(
          `UPDATE event_outbox SET status = 'dead', attempts = $1, last_error = $2 WHERE id = $3`,
          [attempts, msg, row.id],
        );
        await this.deps.pool.query(
          `INSERT INTO job_dead_letter (id, kind, ref_id, step_id, payload, error, attempts)
           VALUES ($1, 'event', $2, NULL, $3, $4, $5)`,
          [`dlq_${row.id}`, row.id, JSON.stringify(event), msg, attempts],
        );
        deadLettered++;
      } else {
        await this.deps.pool.query(
          `UPDATE event_outbox SET attempts = $1, last_error = $2 WHERE id = $3`,
          [attempts, msg, row.id],
        );
        failed++;
      }
    }

    return { processed, failed, deadLettered };
  }
}
