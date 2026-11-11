/**
 * 系统信息与一键升级（ADR-017）的数据层。
 *
 * 边界和后端一致：这里只「排作业 + 读进度」，不执行任何宿主命令。
 * snake_case ↔ camelCase 只在这一层换。
 */
import { adminClient, getAdminApiMode } from './admin-client';

export type SystemJobAction = 'check' | 'backup' | 'upgrade' | 'restore' | 'rollback';
export type SystemJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface SystemJobView {
  id: string;
  action: SystemJobAction;
  status: SystemJobStatus;
  progress: number;
  step: string | null;
  error: string | null;
  log: string | null;
  payloadVersion: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface SystemInfoView {
  version: string;
  commit: string;
  builtAt: string;
  uptimeSeconds: number;
  health: {
    status: string;
    db: string;
    redis: string;
    queue: string;
    migrations: string;
  };
  updateSourceUrl: string;
  updaterOnline: boolean;
  updaterVersion: string | null;
  latestJob: SystemJobView | null;
}

export interface UpdateManifestView {
  version: string;
  notes: string;
  tarballUrl: string;
  sha256: string;
  builtAt: string | null;
}

export interface CheckUpdateView {
  currentVersion: string;
  hasUpdate: boolean;
  latest: UpdateManifestView | null;
  reason: string | null;
}

function jobFrom(raw: Record<string, unknown>): SystemJobView {
  const payload = (raw.payload ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id),
    action: raw.action as SystemJobAction,
    status: raw.status as SystemJobStatus,
    progress: Number(raw.progress ?? 0),
    step: (raw.step as string | null) ?? null,
    error: (raw.error as string | null) ?? null,
    log: (raw.log as string | null) ?? null,
    payloadVersion: (payload.version as string | null) ?? null,
    createdAt: String(raw.created_at ?? ''),
    finishedAt: (raw.finished_at as string | null) ?? null,
  };
}

// ------------------------------------------------------------------ *
// mock 模式：localStorage 种子，演示用
// ------------------------------------------------------------------ *
const JOB_KEY = 'admin:system-jobs';
const SOURCE_KEY = 'admin:update-source';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式下不可写；演示不该因此崩掉
  }
}

function mockInfo(): SystemInfoView {
  const jobs = read<SystemJobView[]>(JOB_KEY, []);
  return {
    version: '1.0.0',
    commit: 'mock',
    builtAt: new Date(Date.now() - 86_400_000).toISOString(),
    uptimeSeconds: 3600,
    health: { status: 'ok', db: 'ok', redis: 'ok', queue: 'ok', migrations: 'ok' },
    updateSourceUrl: read<string>(SOURCE_KEY, ''),
    updaterOnline: true,
    updaterVersion: 'mall-updater/1.0.0',
    latestJob: jobs[0] ?? null,
  };
}

// ------------------------------------------------------------------ *
// 公开 API
// ------------------------------------------------------------------ *
export async function getSystemInfo(): Promise<SystemInfoView> {
  if (getAdminApiMode() !== 'live') return mockInfo();
  const raw = (await adminClient().getSystemInfo()) as Record<string, unknown>;
  const settings = (raw.settings ?? {}) as Record<string, unknown>;
  return {
    version: String(raw.version ?? '0.0.0'),
    commit: String(raw.commit ?? 'unknown'),
    builtAt: String(raw.built_at ?? ''),
    uptimeSeconds: Number(raw.uptime_seconds ?? 0),
    health: (raw.health ?? { status: 'degraded' }) as SystemInfoView['health'],
    updateSourceUrl: String(settings.update_source_url ?? ''),
    updaterOnline: Boolean(raw.updater_online),
    updaterVersion: (settings.updater_version as string | null) ?? null,
    latestJob: raw.latest_job ? jobFrom(raw.latest_job as Record<string, unknown>) : null,
  };
}

export async function setUpdateSource(url: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    write(SOURCE_KEY, url.trim());
    return;
  }
  await adminClient().setSystemUpdateSource(url.trim());
}

export async function checkUpdate(): Promise<CheckUpdateView> {
  if (getAdminApiMode() !== 'live') {
    const source = read<string>(SOURCE_KEY, '');
    if (!source) {
      return { currentVersion: '1.0.0', hasUpdate: false, latest: null, reason: '未配置更新源' };
    }
    return {
      currentVersion: '1.0.0',
      hasUpdate: true,
      latest: {
        version: '1.1.0',
        notes: '示例更新：修复了库存扣减的并发问题。',
        tarballUrl: 'https://releases.example.com/mall-1.1.0.tar.gz',
        sha256: 'a'.repeat(64),
        builtAt: new Date().toISOString(),
      },
      reason: null,
    };
  }
  const raw = (await adminClient().checkSystemUpdate()) as Record<string, unknown>;
  const latest = raw.latest as Record<string, unknown> | null;
  return {
    currentVersion: String(raw.current_version ?? ''),
    hasUpdate: Boolean(raw.has_update),
    latest: latest
      ? {
          version: String(latest.version ?? ''),
          notes: String(latest.notes ?? ''),
          tarballUrl: String(latest.tarball_url ?? ''),
          sha256: String(latest.sha256 ?? ''),
          builtAt: (latest.built_at as string | null) ?? null,
        }
      : null,
    reason: (raw.reason as string | null) ?? null,
  };
}

export async function requestUpgrade(manifest: {
  version: string;
  tarballUrl: string;
  sha256: string;
}): Promise<SystemJobView> {
  if (getAdminApiMode() !== 'live') {
    const jobs = read<SystemJobView[]>(JOB_KEY, []);
    const job: SystemJobView = {
      id: `job_mock_${Date.now()}`,
      action: 'upgrade',
      status: 'running',
      progress: 35,
      step: '下载新版本',
      error: null,
      log: '[35%] 下载新版本',
      payloadVersion: manifest.version,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };
    jobs.unshift(job);
    write(JOB_KEY, jobs);
    return job;
  }
  return jobFrom(
    (await adminClient().requestSystemUpgrade({
      version: manifest.version,
      tarball_url: manifest.tarballUrl,
      sha256: manifest.sha256,
      confirm: true,
    })) as Record<string, unknown>,
  );
}

export async function requestBackup(label: string): Promise<SystemJobView> {
  if (getAdminApiMode() !== 'live') {
    const jobs = read<SystemJobView[]>(JOB_KEY, []);
    const job: SystemJobView = {
      id: `job_mock_${Date.now()}`,
      action: 'backup',
      status: 'succeeded',
      progress: 100,
      step: '备份完成',
      error: null,
      log: '[10%] 准备备份\n[100%] 备份完成',
      payloadVersion: null,
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    jobs.unshift(job);
    write(JOB_KEY, jobs);
    return job;
  }
  return jobFrom(
    (await adminClient().requestSystemBackup({ label })) as Record<string, unknown>,
  );
}

export async function listSystemJobs(): Promise<SystemJobView[]> {
  if (getAdminApiMode() !== 'live') return read<SystemJobView[]>(JOB_KEY, []);
  const res = (await adminClient().listSystemJobs()) as {
    items?: Array<Record<string, unknown>>;
  };
  return (res.items ?? []).map(jobFrom);
}

export async function getSystemJob(id: string): Promise<SystemJobView | null> {
  if (getAdminApiMode() !== 'live') {
    return read<SystemJobView[]>(JOB_KEY, []).find((j) => j.id === id) ?? null;
  }
  return jobFrom((await adminClient().getSystemJob(id)) as Record<string, unknown>);
}
