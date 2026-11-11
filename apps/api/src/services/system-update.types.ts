/** 系统信息与一键升级（ADR-017）。API 只排作业与读进度，宿主命令由升级代理执行。 */

export type SystemUpdateAction = "check" | "backup" | "upgrade" | "restore" | "rollback";
export type SystemUpdateJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export interface SystemUpdateJobDTO {
  id: string;
  action: SystemUpdateAction;
  payload: Record<string, unknown> | null;
  status: SystemUpdateJobStatus;
  progress: number;
  step: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  log: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface SystemSettingsDTO {
  update_source_url: string;
  /** 升级代理最近心跳；null = 从未联系过（一键升级不可用）。 */
  updater_last_seen: string | null;
  updater_version: string | null;
}

export interface SystemInfoDTO {
  version: string;
  commit: string;
  built_at: string;
  uptime_seconds: number;
  health: {
    status: string;
    db: string;
    redis: string;
    queue: string;
    migrations: string;
  };
  settings: SystemSettingsDTO;
  /** 代理 60 秒内有心跳才算在线。 */
  updater_online: boolean;
  latest_job: SystemUpdateJobDTO | null;
}

/** 更新源 manifest（`GET <update_source_url>` 返回的 JSON）。 */
export interface UpdateManifest {
  version: string;
  built_at?: string;
  commit?: string;
  notes?: string;
  tarball_url: string;
  sha256: string;
}

export interface CheckUpdateResult {
  current_version: string;
  latest: UpdateManifest | null;
  has_update: boolean;
  /** 无法判断时（没配源 / 拉取失败）给可读原因，不算错误。 */
  reason?: string;
}

export interface SystemUpdateRepository {
  getSettings(): Promise<SystemSettingsDTO>;
  setUpdateSource(url: string): Promise<SystemSettingsDTO>;
  heartbeat(version: string): Promise<void>;
  createJob(job: {
    id: string;
    action: SystemUpdateAction;
    payload: Record<string, unknown> | null;
    createdBy: string | null;
  }): Promise<SystemUpdateJobDTO>;
  /** 代理领取一个待执行作业；原子（SKIP LOCKED），重复领取不会拿到同一条。 */
  claimNextJob(): Promise<SystemUpdateJobDTO | null>;
  reportProgress(
    id: string,
    patch: { progress?: number; step?: string; log?: string },
  ): Promise<void>;
  completeJob(
    id: string,
    outcome: {
      status: "succeeded" | "failed" | "canceled";
      result?: Record<string, unknown> | null;
      error?: string | null;
      log?: string | null;
    },
  ): Promise<void>;
  getJob(id: string): Promise<SystemUpdateJobDTO | null>;
  listJobs(limit: number): Promise<SystemUpdateJobDTO[]>;
}
