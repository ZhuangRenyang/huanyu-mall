import type {
  DeadLetterEntry,
  ErrorPayload,
  ExecutionRow,
  ExecutionStatus,
  InsertExecution,
  InsertStep,
  StepRow,
} from "@mall/core";
import type { Journal } from "@mall/core";
import type { DeadLetterSink } from "@mall/core";

/** 测试用内存 journal（生产禁 in-memory）。 */
export class InMemoryJournal implements Journal {
  readonly executions = new Map<string, ExecutionRow>();
  private readonly steps = new Map<string, StepRow>();
  private readonly stepIndex = new Map<string, StepRow>();
  private readonly seqCounter = new Map<string, number>();
  private counter = 0;

  async findExecution(workflowId: string, idempotencyKey: string): Promise<ExecutionRow | null> {
    for (const e of this.executions.values()) {
      if (e.workflowId === workflowId && e.idempotencyKey === idempotencyKey) return e;
    }
    return null;
  }
  async insertExecution(input: InsertExecution): Promise<ExecutionRow> {
    const row: ExecutionRow = { ...input, output: undefined, error: null, parentExecution: null, finishedAt: null };
    this.executions.set(row.id, row);
    return row;
  }
  async setStatus(executionId: string, status: ExecutionStatus): Promise<void> {
    const e = this.executions.get(executionId);
    if (e) e.status = status;
  }
  async completeExecution(executionId: string, output: unknown): Promise<void> {
    const e = this.executions.get(executionId);
    if (e) {
      e.status = "completed";
      e.output = output;
      e.finishedAt = new Date();
    }
  }
  async findStep(executionId: string, stepId: string): Promise<StepRow | null> {
    return this.stepIndex.get(`${executionId}:${stepId}`) ?? null;
  }
  async nextSeq(executionId: string): Promise<number> {
    const next = (this.seqCounter.get(executionId) ?? 0) + 1;
    this.seqCounter.set(executionId, next);
    return next;
  }
  async upsertStepRunning(input: InsertStep): Promise<void> {
    const key = `${input.executionId}:${input.stepId}`;
    const existing = this.stepIndex.get(key);
    if (existing) {
      existing.status = "running";
      existing.input = input.input;
      return;
    }
    const row: StepRow = {
      id: `ws_${++this.counter}`,
      executionId: input.executionId,
      stepId: input.stepId,
      seq: input.seq,
      status: "running",
      input: input.input,
      attempts: 0,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      compensatedAt: null,
    };
    this.stepIndex.set(key, row);
    this.steps.set(row.id, row);
  }
  async completeStep(executionId: string, stepId: string, output: unknown, compensateInput: unknown, attempts: number): Promise<void> {
    const row = this.stepIndex.get(`${executionId}:${stepId}`);
    if (!row) return;
    row.status = "completed";
    row.output = output;
    row.compensateInput = compensateInput;
    row.attempts = attempts;
    row.finishedAt = new Date();
  }
  async recordStepFailure(executionId: string, stepId: string, error: ErrorPayload, attempts: number): Promise<void> {
    const row = this.stepIndex.get(`${executionId}:${stepId}`);
    if (!row) return;
    row.status = "failed";
    row.error = error;
    row.attempts = attempts;
    row.finishedAt = new Date();
  }
  async listCompensableDesc(executionId: string): Promise<StepRow[]> {
    return [...this.stepIndex.values()]
      .filter((r) => r.executionId === executionId && r.compensateInput != null && r.compensatedAt == null)
      .sort((a, b) => b.seq - a.seq);
  }
  async markCompensated(stepRowId: string): Promise<void> {
    const row = this.steps.get(stepRowId);
    if (row) {
      row.status = "compensated";
      row.compensatedAt = new Date();
    }
  }
  async markCompensationFailed(stepRowId: string, error: ErrorPayload): Promise<void> {
    const row = this.steps.get(stepRowId);
    if (row) {
      row.status = "compensation_failed";
      row.error = error;
      row.compensatedAt = new Date();
    }
  }
}

export class InMemoryDeadLetter implements DeadLetterSink {
  readonly entries: DeadLetterEntry[] = [];
  async write(entry: DeadLetterEntry): Promise<void> {
    this.entries.push(entry);
  }
}
