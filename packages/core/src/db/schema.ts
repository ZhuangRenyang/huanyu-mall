import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 内核自有表（架构 §5.4）：workflow 引擎持久化 + API 幂等键。
 * 注意：此处 schema 用于 drizzle-kit generate 与运行时类型；
 * 实际 DDL 以手写迁移 packages/core/migrations/*.sql 为唯一事实（含部分索引 WHERE 子句）。
 */

export const workflowExecution = pgTable(
  "workflow_execution",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    error: jsonb("error"),
    attempt: integer("attempt").notNull().default(1),
    parentExecution: text("parent_execution"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_wf_exec_idem").on(t.workflowId, t.idempotencyKey),
    index("idx_wf_exec_stale").on(t.status, t.heartbeatAt),
  ],
);

export const workflowStepExecution = pgTable(
  "workflow_step_execution",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull(),
    stepId: text("step_id").notNull(),
    seq: integer("seq").notNull(),
    status: text("status").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    compensateInput: jsonb("compensate_input"),
    attempts: integer("attempts").notNull().default(0),
    error: jsonb("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    compensatedAt: timestamp("compensated_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_wf_step").on(t.executionId, t.stepId),
    index("idx_wf_step_compensable").on(t.executionId, t.seq),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("uq_idem").on(t.scope, t.key)],
);
