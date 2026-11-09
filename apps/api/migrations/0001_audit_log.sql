-- API 层审计日志（Phase 4 加固）：后台写操作留痕。
-- 约束（与内核迁移一致）：
--   * 只增不删（破坏性变更由 scripts/lint-migrations.ts 拦截）
--   * 幂等：全部使用 IF NOT EXISTS，重复执行不报错
--   * 时间戳一律 timestamptz（UTC）
--   * 本文件不允许包含事务控制语句（BEGIN/COMMIT），迁移执行器自行包裹事务

CREATE TABLE IF NOT EXISTS audit_log (
  id          text PRIMARY KEY,
  actor_type  text NOT NULL CHECK (actor_type IN ('admin', 'customer', 'system')),
  actor_id    text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          text,
  user_agent  text,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 按动作查（审计检索主路径：某个动作发生过哪些变更）
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, created_at DESC);
-- 按实体查（某个商品/订单的完整变更轨迹）
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);
-- 按操作者查（谁改的）
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_type, actor_id, created_at DESC);
-- 纯时间范围翻页（list 默认排序）
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
