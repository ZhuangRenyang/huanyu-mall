import { errors } from "@mall/core";
import { checkHealth } from "./health.js";
import type { ApiConfig } from "../config.js";
import type {
  CheckUpdateResult,
  SystemInfoDTO,
  SystemSettingsDTO,
  SystemUpdateAction,
  SystemUpdateJobDTO,
  SystemUpdateRepository,
  UpdateManifest,
} from "./system-update.types.js";

/**
 * 系统信息与一键升级（ADR-017）。
 *
 * 职责边界很清楚：API **只排作业、读进度、拉更新源清单**。
 * 真正的备份/下载/替换/迁移/回滚全部由宿主机上的升级代理（mall-updater）执行——
 * API 跑在容器里，本来也碰不到宿主的 docker 与源码目录。
 */

/** 代理心跳多少毫秒内算在线。 */
const UPDATER_ONLINE_MS = 60_000;

export class SystemUpdateService {
  constructor(
    private readonly repo: SystemUpdateRepository,
    private readonly config: ApiConfig,
  ) {}

  async getInfo(): Promise<SystemInfoDTO> {
    const [settings, health, jobs] = await Promise.all([
      this.repo.getSettings(),
      checkHealth(this.config),
      this.repo.listJobs(1),
    ]);
    const lastSeen = settings.updater_last_seen ? Date.parse(settings.updater_last_seen) : 0;
    return {
      version: process.env.APP_VERSION || "0.0.0",
      commit: process.env.APP_COMMIT || "unknown",
      built_at: process.env.APP_BUILT_AT || "unknown",
      uptime_seconds: Math.round(process.uptime()),
      health: {
        status: health.status,
        db: health.db,
        redis: health.redis,
        queue: health.queue,
        migrations: health.migrations,
      },
      settings,
      updater_online: lastSeen > 0 && Date.now() - lastSeen < UPDATER_ONLINE_MS,
      latest_job: jobs[0] ?? null,
    };
  }

  async setUpdateSource(url: string): Promise<SystemSettingsDTO> {
    const trimmed = url.trim();
    if (trimmed !== "" && !/^https?:\/\//i.test(trimmed)) {
      throw errors.validation("更新源地址必须以 http:// 或 https:// 开头");
    }
    return this.repo.setUpdateSource(trimmed);
  }

  /**
   * 拉更新源清单并对比版本。
   * 拉不到不报错——返回 reason 让界面显示「无法检查」，而不是把一次网络抖动变成 500。
   */
  async checkUpdate(): Promise<CheckUpdateResult> {
    const current = process.env.APP_VERSION || "0.0.0";
    const settings = await this.repo.getSettings();
    if (!settings.update_source_url) {
      return { current_version: current, latest: null, has_update: false, reason: "未配置更新源" };
    }
    let manifest: UpdateManifest;
    try {
      manifest = await fetchManifest(settings.update_source_url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        current_version: current,
        latest: null,
        has_update: false,
        reason: `更新源不可用：${reason.slice(0, 160)}`,
      };
    }
    return {
      current_version: current,
      latest: manifest,
      has_update: compareVersions(manifest.version, current) > 0,
    };
  }

  /** 建一个升级作业；具体执行交给宿主代理。 */
  async createJob(
    action: SystemUpdateAction,
    payload: Record<string, unknown> | null,
    createdBy: string | null,
  ): Promise<SystemUpdateJobDTO> {
    return this.repo.createJob({ id: `job_${crypto.randomUUID().replace(/-/g, "")}`, action, payload, createdBy });
  }

  // —— 以下由升级代理调用 ——

  async heartbeat(version: string): Promise<void> {
    await this.repo.heartbeat(version);
  }

  claimNextJob(): Promise<SystemUpdateJobDTO | null> {
    return this.repo.claimNextJob();
  }

  reportProgress(
    id: string,
    patch: { progress?: number; step?: string; log?: string },
  ): Promise<void> {
    return this.repo.reportProgress(id, patch);
  }

  completeJob(
    id: string,
    outcome: {
      status: "succeeded" | "failed" | "canceled";
      result?: Record<string, unknown> | null;
      error?: string | null;
      log?: string | null;
    },
  ): Promise<void> {
    return this.repo.completeJob(id, outcome);
  }

  getJob(id: string): Promise<SystemUpdateJobDTO | null> {
    return this.repo.getJob(id);
  }

  listJobs(limit: number): Promise<SystemUpdateJobDTO[]> {
    return this.repo.listJobs(limit);
  }
}

async function fetchManifest(url: string): Promise<UpdateManifest> {
  // SSRF 兜底：拒绝云厂商元数据地址（admin 配的源也不该打到这里）
  if (/169\.254\.169\.254|metadata\.google/i.test(url)) {
    throw new Error("更新源地址不被允许");
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Partial<UpdateManifest>;
  if (!body || typeof body.version !== "string" || typeof body.tarball_url !== "string") {
    throw new Error("更新源返回的清单格式不正确");
  }
  return {
    version: body.version,
    built_at: body.built_at,
    commit: body.commit,
    notes: body.notes,
    tarball_url: body.tarball_url,
    sha256: body.sha256 ?? "",
  };
}

/** 数字语义的版本比较：1.2.10 > 1.2.9，非数字段按字符串比。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.trim().split(".");
  const pb = b.trim().split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const sa = pa[i] ?? "0";
    const sb = pb[i] ?? "0";
    const na = Number(sa);
    const nb = Number(sb);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na > nb ? 1 : -1;
    } else if (sa !== sb) {
      return sa > sb ? 1 : -1;
    }
  }
  return 0;
}
