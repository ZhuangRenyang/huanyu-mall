import type { ZodType } from "zod";
import type { DomainEvent } from "../event/index.js";
import type { Logger } from "../logger/index.js";

/**
 * Workflow 引擎类型（架构 §5.2 / §5.3）。
 * 四个原语：defineWorkflow / ctx.step / StepResponse / StepResponse.permanentFailure。
 */

/** compensation 分类（架构 §5.3）：R=可逆，X=可对冲，I=不可逆。 */
export type CompensationClass = "R" | "X" | "I";

export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "compensating"
  | "compensation_failed";

export type StepStatus =
  | "running"
  | "completed"
  | "failed"
  | "compensated"
  | "compensation_failed";

export interface ErrorPayload {
  code?: number;
  message: string;
  stepId?: string;
  stack?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
  jitter: boolean;
}

/** 步骤执行上下文：补偿函数只能依赖 compensateInput，不能依赖内存状态（§5.5 纪律 3）。 */
export interface StepContext {
  attempt: number;
  /** `${executionId}:${stepId}`，透传给外部（网关幂等键，§5.6）。 */
  idempotencyKey: string;
  logger: Logger;
  resolve<T>(name: string): T;
}

export interface StepDefinition<TInput = unknown, TOutput = unknown, TCompensate = void> {
  /** 全局唯一，写入 journal 作为幂等键的一部分。 */
  id: string;
  /** 每步必须标注 compensation 分类。 */
  compensationClass: CompensationClass;
  invoke(input: TInput, ctx: StepContext): Promise<StepResponse<TOutput, TCompensate>>;
  compensate?(payload: TCompensate, ctx: StepContext): Promise<void>;
  retry?: RetryPolicy;
  /** 默认 10_000ms，超时按 TransientError 处理。 */
  timeoutMs?: number;
}

/** 返回值：把补偿所需的数据显式带出来（§5.2 原语 2）。 */
export class StepResponse<TOutput = unknown, TCompensate = void> {
  constructor(
    readonly output: TOutput,
    readonly compensateInput?: TCompensate,
  ) {}

  static permanentFailure(message: string, compensateInput?: unknown): never {
    throw new PermanentFailureError(message, compensateInput);
  }
}

/** 可重试错误：网络/超时/上游 5xx（§5.7）。 */
export class TransientError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "TransientError";
  }
}

/** 步骤主动声明永久失败（会带上已积累的 compensateInput）。 */
export class PermanentFailureError extends Error {
  constructor(
    message: string,
    readonly compensateInput?: unknown,
  ) {
    super(message);
    this.name = "PermanentFailureError";
  }
}

/** workflow 执行失败（已走完补偿栈）。 */
export class WorkflowFailedError extends Error {
  constructor(
    override readonly cause: unknown,
    readonly executionId: string,
  ) {
    super(`Workflow failed (execution ${executionId})`);
    this.name = "WorkflowFailedError";
  }
}

/** I 类步骤之后不允许再执行其他步骤（§5.3：I 类只能作为最后一步）。 */
export class InvalidWorkflowOrderError extends Error {
  constructor(stepId: string) {
    super(`Irreversible step already executed, cannot run ${stepId} after it`);
    this.name = "InvalidWorkflowOrderError";
  }
}

export interface WorkflowEmitInput<TData = unknown> {
  name: string;
  data: TData;
  correlationId?: string;
}

export interface WorkflowContext {
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly logger: Logger;
  step<TIn, TOut, TComp>(s: StepDefinition<TIn, TOut, TComp>, input: TIn): Promise<TOut>;
  emit(event: WorkflowEmitInput): Promise<void>;
  resolve<T>(name: string): T;
}

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  inputSchema?: ZodType<TInput>;
  /** 默认 30_000ms，与 HTTP 请求生命周期对齐。 */
  timeoutMs?: number;
  run(ctx: WorkflowContext, input: TInput): Promise<TOutput>;
}

export type Workflow<TInput, TOutput> = WorkflowDefinition<TInput, TOutput>;

export interface RunOptions {
  idempotencyKey?: string;
  resolve?: (name: string) => unknown;
  emit?: (event: DomainEvent) => Promise<void>;
}

export interface RunResult<TOutput> {
  result: TOutput;
  executionId: string;
}

export interface ExecutionRow {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  idempotencyKey: string;
  input: unknown;
  output?: unknown;
  error?: ErrorPayload | null;
  attempt: number;
  parentExecution?: string | null;
  startedAt: Date;
  finishedAt?: Date | null;
  heartbeatAt: Date;
}

export interface StepRow {
  id: string;
  executionId: string;
  stepId: string;
  seq: number;
  status: StepStatus;
  input?: unknown;
  output?: unknown;
  compensateInput?: unknown;
  attempts: number;
  error?: ErrorPayload | null;
  startedAt: Date;
  finishedAt?: Date | null;
  compensatedAt?: Date | null;
}

export interface InsertExecution {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  idempotencyKey: string;
  input: unknown;
  attempt: number;
  startedAt: Date;
  heartbeatAt: Date;
}

export interface InsertStep {
  executionId: string;
  stepId: string;
  seq: number;
  status: StepStatus;
  input: unknown;
}

/** 死信条目（§5.7，kind: workflow / queue_job / compensation）。 */
export interface DeadLetterEntry {
  kind: "workflow" | "queue_job" | "compensation";
  refId: string;
  stepId?: string;
  payload: unknown;
  error: ErrorPayload;
  attempts: number;
}

export function defineWorkflow<TInput, TOutput>(
  def: Omit<WorkflowDefinition<TInput, TOutput>, "run">,
  run: (ctx: WorkflowContext, input: TInput) => Promise<TOutput>,
): Workflow<TInput, TOutput> {
  return { ...def, run };
}

export function defineStep<TInput, TOutput, TCompensate = void>(
  def: Omit<StepDefinition<TInput, TOutput, TCompensate>, "invoke" | "compensate"> & {
    invoke: StepDefinition<TInput, TOutput, TCompensate>["invoke"];
    compensate?: StepDefinition<TInput, TOutput, TCompensate>["compensate"];
  },
): StepDefinition<TInput, TOutput, TCompensate> {
  if (!/^[a-z][a-z0-9._-]*$/.test(def.id)) {
    throw new Error(`Invalid step id: ${def.id}`);
  }
  return def;
}
