-- API 层系统信息与一键升级作业（ADR-017）。
-- 约束（与内核迁移一致）：
--   * 只增不删（破坏性变更由 scripts/lint-migrations.ts 拦截）
--   * 幂等：全部使用 IF NOT EXISTS，重复执行不报错
--   * 时间戳一律 timestamptz（UTC）
--   * 本文件不允许包含事务控制语句（BEGIN/COMMIT），迁移执行器自行包裹事务

-- 系统设置单例行：更新源地址等。默认空 = 不检查更新（自部署不一定有更新源）。
CREATE TABLE IF NOT EXISTS system_settings (
  id                text PRIMARY KEY,
  update_source_url text NOT NULL DEFAULT '',
  -- 升级代理心跳：后台据此显示「一键升级可用 / 未检测到代理」
  updater_last_seen timestamptz,
  updater_version   text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_settings (id) VALUES ('system_default')
ON CONFLICT (id) DO NOTHING;

-- 升级/备份作业队列：宿主升级代理（mall-updater）领取并执行。
-- API 只写作业与读进度，永远不自己执行宿主命令（API 在容器里，也做不到）。
CREATE TABLE IF NOT EXISTS system_update_job (
  id          text PRIMARY KEY,
  action      text NOT NULL CHECK (action IN ('check', 'backup', 'upgrade', 'restore', 'rollback')),
  payload     jsonb,
  status      text NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  progress    integer NOT NULL DEFAULT 0,
  step        text,
  result      jsonb,
  error       text,
  log         text,
  created_by  text,
  claimed_at  timestamptz,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 代理领取路径：只看 queued / running
CREATE INDEX IF NOT EXISTS idx_system_update_job_status ON system_update_job (status, created_at DESC);
-- 后台列表：最近的作业
CREATE INDEX IF NOT EXISTS idx_system_update_job_created ON system_update_job (created_at DESC);
