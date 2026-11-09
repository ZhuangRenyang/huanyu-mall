-- 内核迁移 0001：workflow 引擎持久化（对齐架构 §5.4）
-- 仅框架验证用。约束：
--   * 迁移只增不删（破坏性变更由 scripts/lint-migrations.ts 拦截）
--   * 时间戳一律 timestamptz（UTC）
--   * 软删表需 deleted_at timestamptz + 部分唯一索引 WHERE deleted_at IS NULL（见注释）
--   * 本文件不允许包含事务控制语句（BEGIN/COMMIT），迁移执行器自行包裹事务

-- 内核表 1：一次执行
CREATE TABLE workflow_execution (
  id                text PRIMARY KEY,
  workflow_id       text NOT NULL,
  status            text NOT NULL,
  idempotency_key   text NOT NULL,
  input             jsonb NOT NULL,
  output            jsonb,
  error             jsonb,
  attempt           integer NOT NULL DEFAULT 1,
  parent_execution  text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  heartbeat_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_wf_exec_idem ON workflow_execution (workflow_id, idempotency_key);
CREATE INDEX idx_wf_exec_stale ON workflow_execution (status, heartbeat_at)
  WHERE status IN ('running', 'compensating');

-- 内核表 2：步骤日志（幂等 + 重放 + 补偿栈）
CREATE TABLE workflow_step_execution (
  id                    text PRIMARY KEY,
  execution_id          text NOT NULL REFERENCES workflow_execution(id),
  step_id               text NOT NULL,
  seq                   integer NOT NULL,
  status                text NOT NULL,
  input                 jsonb,
  output                jsonb,
  compensate_input      jsonb,
  attempts              integer NOT NULL DEFAULT 0,
  error                 jsonb,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  compensated_at        timestamptz
);
CREATE UNIQUE INDEX uq_wf_step ON workflow_step_execution (execution_id, step_id);
CREATE INDEX idx_wf_step_compensable ON workflow_step_execution (execution_id, seq DESC)
  WHERE compensate_input IS NOT NULL AND compensated_at IS NULL;

-- 内核表 3：API 层幂等键
CREATE TABLE idempotency_keys (
  scope          text NOT NULL,
  key            text NOT NULL,
  request_hash   text NOT NULL,
  status_code    integer,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);
CREATE UNIQUE INDEX uq_idem ON idempotency_keys (scope, key);

-- 软删 + 部分唯一索引约定示例（供后续模块迁移参考，此处不建表）：
--   CREATE UNIQUE INDEX uq_xxx_slug ON xxx (slug) WHERE deleted_at IS NULL;
