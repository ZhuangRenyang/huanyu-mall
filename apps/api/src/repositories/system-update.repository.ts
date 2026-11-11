import type { Pool } from "pg";
import type {
  SystemSettingsDTO,
  SystemUpdateAction,
  SystemUpdateJobDTO,
  SystemUpdateJobStatus,
  SystemUpdateRepository,
} from "../services/system-update.types.js";
import { toJsonSafe } from "../utils/json.js";

/**
 * 系统升级作业仓储：只做数据存取。
 * 领取用 `FOR UPDATE SKIP LOCKED`，多开几个代理也不会把同一条作业执行两遍。
 */
export class PgSystemUpdateRepository implements SystemUpdateRepository {
  constructor(private readonly pool: Pool) {}

  async getSettings(): Promise<SystemSettingsDTO> {
    const res = await this.pool.query(
      `SELECT update_source_url, updater_last_seen, updater_version
         FROM system_settings WHERE id = $1`,
      ["system_default"],
    );
    const row = res.rows[0];
    return {
      update_source_url: row?.update_source_url ?? "",
      updater_last_seen: row?.updater_last_seen ? new Date(row.updater_last_seen).toISOString() : null,
      updater_version: row?.updater_version ?? null,
    };
  }

  async setUpdateSource(url: string): Promise<SystemSettingsDTO> {
    await this.pool.query(
      `INSERT INTO system_settings (id, update_source_url, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET update_source_url = $2, updated_at = now()`,
      ["system_default", url],
    );
    return this.getSettings();
  }

  async heartbeat(version: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO system_settings (id, update_source_url, updater_last_seen, updater_version, updated_at)
       VALUES ($1, '', now(), $2, now())
       ON CONFLICT (id) DO UPDATE SET updater_last_seen = now(), updater_version = $2, updated_at = now()`,
      ["system_default", version],
    );
  }

  async createJob(job: {
    id: string;
    action: SystemUpdateAction;
    payload: Record<string, unknown> | null;
    createdBy: string | null;
  }): Promise<SystemUpdateJobDTO> {
    const res = await this.pool.query(
      `INSERT INTO system_update_job (id, action, payload, status, created_by)
       VALUES ($1, $2, $3, 'queued', $4)
       RETURNING *`,
      [job.id, job.action, toJsonSafe(job.payload), job.createdBy],
    );
    return toJob(res.rows[0]);
  }

  async claimNextJob(): Promise<SystemUpdateJobDTO | null> {
    const res = await this.pool.query(
      `UPDATE system_update_job
          SET status = 'running', claimed_at = now(), started_at = COALESCE(started_at, now())
        WHERE id = (
          SELECT id FROM system_update_job
           WHERE status = 'queued'
           ORDER BY created_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
    RETURNING *`,
    );
    return res.rows[0] ? toJob(res.rows[0]) : null;
  }

  async reportProgress(
    id: string,
    patch: { progress?: number; step?: string; log?: string },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE system_update_job
          SET progress = COALESCE($2, progress),
              step     = COALESCE($3, step),
              log      = CASE WHEN $4::text IS NULL THEN log
                              WHEN log IS NULL THEN $4::text
                              ELSE log || E'\n' || $4::text END
        WHERE id = $1`,
      [id, patch.progress ?? null, patch.step ?? null, patch.log ?? null],
    );
  }

  async completeJob(
    id: string,
    outcome: {
      status: "succeeded" | "failed" | "canceled";
      result?: Record<string, unknown> | null;
      error?: string | null;
      log?: string | null;
    },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE system_update_job
          SET status = $2, result = $3, error = $4, finished_at = now(),
              progress = CASE WHEN $2 = 'succeeded' THEN 100 ELSE progress END,
              log = CASE WHEN $5::text IS NULL THEN log
                          WHEN log IS NULL THEN $5::text
                          ELSE log || E'\n' || $5::text END
        WHERE id = $1`,
      [
        id,
        outcome.status,
        toJsonSafe(outcome.result ?? null),
        outcome.error ?? null,
        outcome.log ?? null,
      ],
    );
  }

  async getJob(id: string): Promise<SystemUpdateJobDTO | null> {
    const res = await this.pool.query(`SELECT * FROM system_update_job WHERE id = $1`, [id]);
    return res.rows[0] ? toJob(res.rows[0]) : null;
  }

  async listJobs(limit: number): Promise<SystemUpdateJobDTO[]> {
    const res = await this.pool.query(
      `SELECT * FROM system_update_job ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map(toJob);
  }
}

function toJob(row: Record<string, unknown>): SystemUpdateJobDTO {
  return {
    id: String(row.id),
    action: row.action as SystemUpdateAction,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    status: row.status as SystemUpdateJobStatus,
    progress: Number(row.progress ?? 0),
    step: (row.step as string | null) ?? null,
    result: (row.result as Record<string, unknown> | null) ?? null,
    error: (row.error as string | null) ?? null,
    log: (row.log as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: new Date(String(row.created_at)).toISOString(),
    started_at: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
    finished_at: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
  };
}
