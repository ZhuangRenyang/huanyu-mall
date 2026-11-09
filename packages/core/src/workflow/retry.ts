import type { Pool } from "pg";
import type { DeadLetterEntry, ErrorPayload, RetryPolicy } from "./types.js";
import { TransientError } from "./types.js";

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, baseMs: 200, maxMs: 5_000, jitter: true };

/** 指数退避（含可选抖动，§5.5）。 */
export function backoff(policy: RetryPolicy, attempt: number): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1));
  if (!policy.jitter) return exp;
  const jitter = Math.random() * exp * 0.2;
  return Math.round(exp + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TransientError(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === policy.maxAttempts) break;
      await sleep(backoff(policy, attempt));
    }
  }
  throw lastErr;
}

/** 是否可重试（§5.7）：仅 TransientError 可重试；DomainError/permanentFailure 不可。 */
export function isRetryable(err: unknown): boolean {
  return err instanceof TransientError;
}

export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
    };
  }
  return { message: String(err) };
}

/** 死信写入接口（§5.7：引擎不直连模块表，生产由 eventBus 承载，这里给适配层）。 */
export interface DeadLetterSink {
  write(entry: DeadLetterEntry): Promise<void>;
}

/** 落 job_dead_letter（表由 M12 event-bus 模块建迁移；引擎侧只做适配写入）。 */
export class PostgresDeadLetter implements DeadLetterSink {
  constructor(private readonly pool: Pool) {}

  async write(entry: DeadLetterEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO job_dead_letter (id, kind, ref_id, step_id, payload, error, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `dlq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        entry.kind,
        entry.refId,
        entry.stepId ?? null,
        JSON.stringify(entry.payload),
        JSON.stringify(entry.error),
        entry.attempts,
      ],
    );
  }
}
