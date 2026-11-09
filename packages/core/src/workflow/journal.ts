import type { Pool } from "pg";
import { prefixedUlid } from "../utils/index.js";
import type {
  ErrorPayload,
  ExecutionRow,
  ExecutionStatus,
  InsertExecution,
  InsertStep,
  StepRow,
} from "./types.js";

/** bigint 安全的 JSON 序列化：BigInt → Number（一期金额 < 2^53 安全，架构 §16 坑 1）。 */
function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v));
}

/**
 * Journal 持久化契约：workflow_execution / workflow_step_execution 读写（架构 §5.4）。
 * 生产用 PostgresJournal；测试注入 InMemoryJournal（仅测试用，生产禁 in-memory）。
 */
export interface Journal {
  findExecution(workflowId: string, idempotencyKey: string): Promise<ExecutionRow | null>;
  insertExecution(input: InsertExecution): Promise<ExecutionRow>;
  setStatus(executionId: string, status: ExecutionStatus): Promise<void>;
  completeExecution(executionId: string, output: unknown): Promise<void>;
  findStep(executionId: string, stepId: string): Promise<StepRow | null>;
  nextSeq(executionId: string): Promise<number>;
  upsertStepRunning(input: InsertStep): Promise<void>;
  completeStep(executionId: string, stepId: string, output: unknown, compensateInput: unknown, attempts: number): Promise<void>;
  recordStepFailure(executionId: string, stepId: string, error: ErrorPayload, attempts: number): Promise<void>;
  listCompensableDesc(executionId: string): Promise<StepRow[]>;
  markCompensated(stepRowId: string): Promise<void>;
  markCompensationFailed(stepRowId: string, error: ErrorPayload): Promise<void>;
}

/** Postgres 实现：参数化 SQL，复用已有 schema（迁移 0001_workflow.sql）。 */
export class PostgresJournal implements Journal {
  constructor(private readonly pool: Pool) {}

  async findExecution(workflowId: string, idempotencyKey: string): Promise<ExecutionRow | null> {
    const res = await this.pool.query(
      `SELECT * FROM workflow_execution WHERE workflow_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [workflowId, idempotencyKey],
    );
    return res.rows[0] ? mapExecution(res.rows[0]) : null;
  }

  async insertExecution(input: InsertExecution): Promise<ExecutionRow> {
    const res = await this.pool.query(
      `INSERT INTO workflow_execution
         (id, workflow_id, status, idempotency_key, input, attempt, started_at, heartbeat_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.id,
        input.workflowId,
        input.status,
        input.idempotencyKey,
        stringify(input.input),
        input.attempt,
        input.startedAt,
        input.heartbeatAt,
      ],
    );
    return mapExecution(res.rows[0]);
  }

  async setStatus(executionId: string, status: ExecutionStatus): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_execution SET status = $2, heartbeat_at = now() WHERE id = $1`,
      [executionId, status],
    );
  }

  async completeExecution(executionId: string, output: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_execution SET status = 'completed', output = $2, finished_at = now() WHERE id = $1`,
      [executionId, stringify(output)],
    );
  }

  async findStep(executionId: string, stepId: string): Promise<StepRow | null> {
    const res = await this.pool.query(
      `SELECT * FROM workflow_step_execution WHERE execution_id = $1 AND step_id = $2 LIMIT 1`,
      [executionId, stepId],
    );
    return res.rows[0] ? mapStep(res.rows[0]) : null;
  }

  async nextSeq(executionId: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM workflow_step_execution WHERE execution_id = $1`,
      [executionId],
    );
    return Number(res.rows[0]?.next ?? 1);
  }

  async upsertStepRunning(input: InsertStep): Promise<void> {
    await this.pool.query(
      `INSERT INTO workflow_step_execution
         (id, execution_id, step_id, seq, status, input, attempts, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, now())
       ON CONFLICT (execution_id, step_id)
       DO UPDATE SET status = 'running', input = EXCLUDED.input`,
      [
        prefixedUlid("ws"),
        input.executionId,
        input.stepId,
        input.seq,
        input.status,
        stringify(input.input),
      ],
    );
  }

  async completeStep(
    executionId: string,
    stepId: string,
    output: unknown,
    compensateInput: unknown,
    attempts: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_step_execution
       SET status = 'completed', output = $3, compensate_input = $4, attempts = $5, finished_at = now()
       WHERE execution_id = $1 AND step_id = $2`,
      [executionId, stepId, stringify(output), stringify(compensateInput), attempts],
    );
  }

  async recordStepFailure(
    executionId: string,
    stepId: string,
    error: ErrorPayload,
    attempts: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_step_execution
       SET status = 'failed', error = $3, attempts = $4, finished_at = now()
       WHERE execution_id = $1 AND step_id = $2`,
      [executionId, stepId, stringify(error), attempts],
    );
  }

  async listCompensableDesc(executionId: string): Promise<StepRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM workflow_step_execution
       WHERE execution_id = $1 AND compensate_input IS NOT NULL AND compensated_at IS NULL
       ORDER BY seq DESC`,
      [executionId],
    );
    return res.rows.map(mapStep);
  }

  async markCompensated(stepRowId: string): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_step_execution SET status = 'compensated', compensated_at = now() WHERE id = $1`,
      [stepRowId],
    );
  }

  async markCompensationFailed(stepRowId: string, error: ErrorPayload): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_step_execution SET status = 'compensation_failed', error = $2, compensated_at = now() WHERE id = $1`,
      [stepRowId, stringify(error)],
    );
  }
}

function mapExecution(row: Record<string, unknown>): ExecutionRow {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    status: row.status as ExecutionStatus,
    idempotencyKey: String(row.idempotency_key),
    input: row.input,
    output: row.output,
    error: (row.error as ErrorPayload | null) ?? null,
    attempt: Number(row.attempt),
    parentExecution: (row.parent_execution as string | null) ?? null,
    startedAt: row.started_at as Date,
    finishedAt: (row.finished_at as Date | null) ?? null,
    heartbeatAt: row.heartbeat_at as Date,
  };
}

function mapStep(row: Record<string, unknown>): StepRow {
  return {
    id: String(row.id),
    executionId: String(row.execution_id),
    stepId: String(row.step_id),
    seq: Number(row.seq),
    status: row.status as StepRow["status"],
    input: row.input,
    output: row.output,
    compensateInput: row.compensate_input,
    attempts: Number(row.attempts),
    error: (row.error as ErrorPayload | null) ?? null,
    startedAt: row.started_at as Date,
    finishedAt: (row.finished_at as Date | null) ?? null,
    compensatedAt: (row.compensated_at as Date | null) ?? null,
  };
}
