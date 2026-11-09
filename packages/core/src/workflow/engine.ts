import { prefixedUlid } from "../utils/index.js";
import type { DomainEvent } from "../event/index.js";
import type { Logger } from "../logger/index.js";
import type { Journal } from "./journal.js";
import { backoff, DEFAULT_RETRY, isRetryable, sleep, toErrorPayload, withRetry, withTimeout, type DeadLetterSink } from "./retry.js";
import type { WorkflowRegistry } from "./registry.js";
import type {
  ExecutionRow,
  RunOptions,
  RunResult,
  StepContext,
  StepDefinition,
  Workflow,
  WorkflowContext,
  WorkflowEmitInput,
} from "./types.js";
import { InvalidWorkflowOrderError, WorkflowFailedError } from "./types.js";

const COMPENSATION_RETRY = { maxAttempts: 5, baseMs: 500, maxMs: 30_000, jitter: true };

export interface EngineDeps {
  journal: Journal;
  deadLetter: DeadLetterSink;
  registry: WorkflowRegistry;
  logger: Logger;
  resolve?: (name: string) => unknown;
}

interface RunState {
  irreversibleSeen: boolean;
}

/** 顺序步骤 + 补偿栈 + journal 重放（架构 §5.5）。 */
export class WorkflowEngine {
  constructor(private readonly deps: EngineDeps) {}

  async run<TOut>(workflow: Workflow<any, TOut>, input: unknown, opts: RunOptions = {}): Promise<RunResult<TOut>> {
    const idem = opts.idempotencyKey ?? `auto_${prefixedUlid("idem")}`;
    workflow.inputSchema?.parse(input);

    let exec = await this.deps.journal.findExecution(workflow.id, idem);
    if (!exec) {
      exec = await this.deps.journal.insertExecution({
        id: prefixedUlid("wf"),
        workflowId: workflow.id,
        status: "pending",
        idempotencyKey: idem,
        input,
        attempt: 1,
        startedAt: new Date(),
        heartbeatAt: new Date(),
      });
    }

    if (exec.status === "completed") {
      return { result: exec.output as TOut, executionId: exec.id };
    }
    if (exec.status === "failed" || exec.status === "compensation_failed") {
      throw new WorkflowFailedError(exec.error, exec.id);
    }

    await this.deps.journal.setStatus(exec.id, "running");
    const state: RunState = { irreversibleSeen: false };
    const ctx = this.buildContext(workflow, exec, opts, state);

    try {
      const result = await withTimeout(workflow.run(ctx, input), workflow.timeoutMs ?? 30_000);
      await this.deps.journal.completeExecution(exec.id, result);
      return { result, executionId: exec.id };
    } catch (err) {
      await this.compensate(exec.id, err);
      throw new WorkflowFailedError(err, exec.id);
    }
  }

  private buildContext(
    workflow: Workflow<any, any>,
    exec: ExecutionRow,
    opts: RunOptions,
    state: RunState,
  ): WorkflowContext {
    const resolve = <T>(name: string): T => {
      if (!this.deps.resolve) throw new Error(`container resolve not configured (${name})`);
      return this.deps.resolve(name) as T;
    };
    return {
      executionId: exec.id,
      idempotencyKey: exec.idempotencyKey,
      logger: this.deps.logger,
      resolve,
      emit: async (event: WorkflowEmitInput) => {
        const full: DomainEvent = {
          id: prefixedUlid("evt"),
          name: event.name,
          data: event.data,
          occurredAt: new Date().toISOString(),
          correlationId: event.correlationId ?? exec.id,
        };
        await (opts.emit ?? (async () => {}))(full);
      },
      step: (s, input) => this.step(exec, s, input, state),
    };
  }

  /** run-or-replay：已完成步骤直接返回 journal output，不二次执行副作用（§5.5 心脏）。 */
  private async step<TIn, TOut, TComp>(
    exec: ExecutionRow,
    s: StepDefinition<TIn, TOut, TComp>,
    input: TIn,
    state: RunState,
  ): Promise<TOut> {
    if (state.irreversibleSeen) {
      throw new InvalidWorkflowOrderError(s.id);
    }

    const existing = await this.deps.journal.findStep(exec.id, s.id);
    if (existing?.status === "completed") {
      if (s.compensationClass === "I") state.irreversibleSeen = true;
      return existing.output as TOut;
    }

    const seq = await this.deps.journal.nextSeq(exec.id);
    await this.deps.journal.upsertStepRunning({
      executionId: exec.id,
      stepId: s.id,
      seq,
      status: "running",
      input,
    });

    const policy = s.retry ?? DEFAULT_RETRY;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      const stepCtx = this.stepContext(exec.id, s.id, attempt);
      try {
        const resp = await withTimeout(s.invoke(input, stepCtx), s.timeoutMs ?? 10_000);
        await this.deps.journal.completeStep(exec.id, s.id, resp.output, resp.compensateInput, attempt);
        if (s.compensationClass === "I") state.irreversibleSeen = true;
        return resp.output;
      } catch (err) {
        lastErr = err;
        await this.deps.journal.recordStepFailure(exec.id, s.id, toErrorPayload(err), attempt);
        if (!isRetryable(err) || attempt === policy.maxAttempts) break;
        await sleep(backoff(policy, attempt));
      }
    }

    // 仅可重试错误在耗尽重试后进死信；DomainError/permanent 属正常业务失败，直接补偿。
    if (isRetryable(lastErr)) {
      await this.deps.deadLetter.write({
        kind: "workflow",
        refId: exec.id,
        stepId: s.id,
        payload: input,
        error: toErrorPayload(lastErr),
        attempts: policy.maxAttempts,
      });
    }
    throw lastErr;
  }

  /** 补偿：倒序、幂等、可重试；失败进 compensation_failed + 死信，保留现场交人工（§5.5）。 */
  private async compensate(executionId: string, cause: unknown): Promise<void> {
    await this.deps.journal.setStatus(executionId, "compensating");
    const rows = await this.deps.journal.listCompensableDesc(executionId);

    for (const row of rows) {
      const step = this.deps.registry.getStep(row.stepId);
      if (!step?.compensate) {
        if (row.compensateInput != null) {
          const errPayload = { message: `step ${row.stepId} missing compensate` };
          await this.deps.journal.markCompensationFailed(row.id, errPayload);
          await this.deps.deadLetter.write({
            kind: "compensation",
            refId: executionId,
            stepId: row.stepId,
            payload: row.compensateInput,
            error: errPayload,
            attempts: 0,
          });
          await this.deps.journal.setStatus(executionId, "compensation_failed");
          this.deps.logger.error({ executionId, stepId: row.stepId }, "compensation_failed: missing compensate");
          return;
        }
        continue;
      }

      const stepCtx = this.stepContext(executionId, row.stepId, 1);
      try {
        await withRetry(() => step.compensate!(row.compensateInput, stepCtx), COMPENSATION_RETRY);
        await this.deps.journal.markCompensated(row.id);
      } catch (err) {
        await this.deps.journal.markCompensationFailed(row.id, toErrorPayload(err));
        await this.deps.deadLetter.write({
          kind: "compensation",
          refId: executionId,
          stepId: row.stepId,
          payload: row.compensateInput,
          error: toErrorPayload(err),
          attempts: COMPENSATION_RETRY.maxAttempts,
        });
        await this.deps.journal.setStatus(executionId, "compensation_failed");
        this.deps.logger.error({ executionId, stepId: row.stepId, cause: toErrorPayload(cause), err: toErrorPayload(err) }, "compensation_failed");
        return;
      }
    }

    await this.deps.journal.setStatus(executionId, "failed");
    this.deps.logger.warn({ executionId, cause: toErrorPayload(cause) }, "workflow_failed_and_compensated");
  }

  private stepContext(executionId: string, stepId: string, attempt: number): StepContext {
    return {
      attempt,
      idempotencyKey: `${executionId}:${stepId}`,
      logger: this.deps.logger,
      resolve: <T>(name: string): T => {
        if (!this.deps.resolve) throw new Error(`container resolve not configured (${name})`);
        return this.deps.resolve(name) as T;
      },
    };
  }
}
