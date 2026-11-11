/**
 * 系统升级的测试替身：作业队列放内存，够跑通「排作业 → 领作业 → 报进度 → 报结果」。
 * 不模拟宿主执行——那是升级代理的事，不在 API 的测试范围里。
 */
import type {
  SystemInfoDTO,
  SystemSettingsDTO,
  SystemUpdateAction,
  SystemUpdateJobDTO,
  SystemUpdateJobStatus,
  SystemUpdateRepository,
} from "../../src/services/system-update.types.js";

class InMemorySystemUpdateRepository implements SystemUpdateRepository {
  settings: SystemSettingsDTO = {
    update_source_url: "",
    updater_last_seen: null,
    updater_version: null,
  };
  jobs: SystemUpdateJobDTO[] = [];
  private seq = 0;

  async getSettings(): Promise<SystemSettingsDTO> {
    return { ...this.settings };
  }

  async setUpdateSource(url: string): Promise<SystemSettingsDTO> {
    this.settings.update_source_url = url;
    return { ...this.settings };
  }

  async heartbeat(version: string): Promise<void> {
    this.settings.updater_last_seen = new Date().toISOString();
    this.settings.updater_version = version;
  }

  async createJob(job: {
    id: string;
    action: SystemUpdateAction;
    payload: Record<string, unknown> | null;
    createdBy: string | null;
  }): Promise<SystemUpdateJobDTO> {
    const row: SystemUpdateJobDTO = {
      id: job.id,
      action: job.action,
      payload: job.payload,
      status: "queued",
      progress: 0,
      step: null,
      result: null,
      error: null,
      log: null,
      created_by: job.createdBy,
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
    };
    this.jobs.unshift(row);
    return row;
  }

  async claimNextJob(): Promise<SystemUpdateJobDTO | null> {
    const job = this.jobs.find((j) => j.status === "queued");
    if (!job) return null;
    job.status = "running";
    job.started_at = new Date().toISOString();
    return job;
  }

  async reportProgress(
    id: string,
    patch: { progress?: number; step?: string; log?: string },
  ): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (patch.progress !== undefined) job.progress = patch.progress;
    if (patch.step !== undefined) job.step = patch.step;
    if (patch.log !== undefined) job.log = job.log ? `${job.log}\n${patch.log}` : patch.log;
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
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.status = outcome.status as SystemUpdateJobStatus;
    job.result = outcome.result ?? null;
    job.error = outcome.error ?? null;
    job.finished_at = new Date().toISOString();
    if (outcome.status === "succeeded") job.progress = 100;
  }

  async getJob(id: string): Promise<SystemUpdateJobDTO | null> {
    return this.jobs.find((j) => j.id === id) ?? null;
  }

  async listJobs(limit: number): Promise<SystemUpdateJobDTO[]> {
    return this.jobs.slice(0, limit);
  }
}

let fakeJobSeq = 0;

export function makeFakeSystemUpdate() {
  const repo = new InMemorySystemUpdateRepository();
  return {
    __repo: repo,
    getInfo: async (): Promise<SystemInfoDTO> => ({
      version: "1.0.0",
      commit: "test",
      built_at: "2026-11-11T00:00:00Z",
      uptime_seconds: 1,
      health: { status: "ok", db: "ok", redis: "ok", queue: "ok", migrations: "ok" },
      settings: await repo.getSettings(),
      updater_online: (() => {
        const seen = repo.settings.updater_last_seen;
        return seen ? Date.now() - Date.parse(seen) < 60_000 : false;
      })(),
      latest_job: (await repo.listJobs(1))[0] ?? null,
    }),
    setUpdateSource: (url: string) => repo.setUpdateSource(url),
    checkUpdate: async () => {
      const settings = await repo.getSettings();
      if (!settings.update_source_url) {
        return { current_version: "1.0.0", latest: null, has_update: false, reason: "未配置更新源" };
      }
      return {
        current_version: "1.0.0",
        latest: {
          version: "1.1.0",
          tarball_url: "https://example.com/mall-1.1.0.tar.gz",
          sha256: "a".repeat(64),
          notes: "测试版本",
        },
        has_update: true,
      };
    },
    createJob: (
      action: SystemUpdateAction,
      payload: Record<string, unknown> | null,
      createdBy: string | null,
    ) => repo.createJob({ id: `job_fake_${++fakeJobSeq}`, action, payload, createdBy }),
    heartbeat: (version: string) => repo.heartbeat(version),
    claimNextJob: () => repo.claimNextJob(),
    reportProgress: repo.reportProgress.bind(repo),
    completeJob: repo.completeJob.bind(repo),
    getJob: (id: string) => repo.getJob(id),
    listJobs: (limit: number) => repo.listJobs(limit),
  };
}
