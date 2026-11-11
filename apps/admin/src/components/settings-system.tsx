import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@mall/ui';
import { TextField } from './field';
import {
  checkUpdate,
  getSystemInfo,
  getSystemJob,
  listSystemJobs,
  requestBackup,
  requestUpgrade,
  setUpdateSource,
  type CheckUpdateView,
  type SystemInfoView,
  type SystemJobView,
} from '@/lib/admin-system';

const HEALTH_LABEL: Record<string, string> = {
  ok: '正常',
  degraded: '异常',
};

const JOB_STATUS_META: Record<
  SystemJobView['status'],
  { label: string; variant: 'success' | 'warning' | 'neutral' | 'destructive' }
> = {
  succeeded: { label: '已完成', variant: 'success' },
  running: { label: '进行中', variant: 'warning' },
  queued: { label: '排队中', variant: 'neutral' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '已取消', variant: 'neutral' },
};

/**
 * 系统页（ADR-017）：版本与健康、更新源、一键升级、备份。
 *
 * 两条不能省的底线：
 * 1. 升级是破坏性操作，必须二次确认（Dialog），且失败要**持续显示横幅**——
 *    半夜升级炸了、人不在终端前，后台必须自己喊出来（PRD 一节明确要求）。
 * 2. 进度来自宿主升级代理，不在这里编造：代理离线时按钮禁用并说明原因。
 */
export function SystemSettings() {
  const [info, setInfo] = useState<SystemInfoView | null>(null);
  const [source, setSource] = useState('');
  const [savingSource, setSavingSource] = useState(false);
  const [check, setCheck] = useState<CheckUpdateView | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<SystemJobView[]>([]);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const [next, jobList] = await Promise.all([
      getSystemInfo().catch(() => null),
      listSystemJobs().catch(() => [] as SystemJobView[]),
    ]);
    if (next) {
      setInfo(next);
      setSource((prev) => (prev === '' ? next.updateSourceUrl : prev));
    }
    setJobs(jobList);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 有作业在跑时轮询进度；跑完停，不空转
  useEffect(() => {
    const active = jobs.find((j) => j.status === 'running' || j.status === 'queued');
    if (!active) return;
    pollRef.current = window.setInterval(() => {
      void getSystemJob(active.id)
        .then((job) => {
          if (!job) return;
          setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
          if (job.status === 'succeeded' || job.status === 'failed') void reload();
        })
        .catch(() => {});
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobs, reload]);

  const saveSource = async () => {
    setSavingSource(true);
    setError(null);
    try {
      await setUpdateSource(source);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingSource(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      setCheck(await checkUpdate());
    } catch (err) {
      setError(err instanceof Error ? err.message : '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  const runUpgrade = async () => {
    if (!check?.latest) return;
    setBusy(true);
    setError(null);
    try {
      await requestUpgrade({
        version: check.latest.version,
        tarballUrl: check.latest.tarballUrl,
        sha256: check.latest.sha256,
      });
      setConfirmOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发起升级失败');
    } finally {
      setBusy(false);
    }
  };

  const runBackup = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestBackup('manual');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发起备份失败');
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <p className="text-sm text-muted-foreground">正在读取系统信息…</p>;

  const failedJob = jobs.find((j) => j.status === 'failed');
  const activeJob = jobs.find((j) => j.status === 'running' || j.status === 'queued');

  return (
    <div className="max-w-3xl space-y-4">
      {failedJob && (
        <section
          className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-destructive bg-destructive-subtle p-4"
          role="alert"
        >
          <div>
            <h2 className="text-sm font-semibold text-destructive">升级失败，已自动回滚</h2>
            <p className="mt-1 text-xs leading-5 text-destructive">
              {failedJob.error ?? '原因未知'}。当前仍运行旧版本，经营不受影响。
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setOpenLog(failedJob.id)}>
            查看日志
          </Button>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">当前版本</h2>
        <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Field label="版本号" value={info.version} />
          <Field label="构建提交" value={info.commit} />
          <Field label="构建时间" value={info.builtAt} />
          <Field label="运行时长" value={`${Math.round(info.uptimeSeconds / 60)} 分钟`} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>运行状态</span>
          {(['db', 'redis', 'queue'] as const).map((key) => (
            <Badge key={key} variant={info.health[key] === 'ok' ? 'success' : 'destructive'}>
              {key.toUpperCase()} · {HEALTH_LABEL[info.health[key]] ?? info.health[key]}
            </Badge>
          ))}
          <Badge variant={info.health.status === 'ok' ? 'success' : 'warning'}>
            迁移 · {info.health.migrations}
          </Badge>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">一键升级</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
              升级由服务器上的升级代理执行：备份 → 下载校验 → 替换程序 → 迁移 → 健康检查。
              任一步失败都会自动回滚到旧版本，业务数据不受影响。
            </p>
          </div>
          {info.updaterOnline ? (
            <Badge variant="success">代理在线</Badge>
          ) : (
            <Badge variant="warning">未检测到升级代理</Badge>
          )}
        </div>

        {!info.updaterOnline && (
          <p className="mt-2 text-xs text-warning" role="status">
            升级代理未运行，一键升级不可用。请在服务器上执行安装脚本（会自动安装并启动
            mall-updater），或手工运行升级命令。
          </p>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <TextField
            id="sys-update-source"
            label="更新源地址（返回版本清单 JSON）"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="https://releases.example.com/mall/latest.json"
          />
          <Button variant="secondary" className="self-end" disabled={savingSource} onClick={() => void saveSource()}>
            {savingSource ? '保存中…' : '保存'}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={checking || !source.trim()} onClick={() => void runCheck()}>
            {checking ? '检查中…' : '检查更新'}
          </Button>
          {check && !check.hasUpdate && (
            <span className="text-xs text-muted-foreground" role="status">
              {check.reason ?? `已是最新版本（${check.currentVersion}）`}
            </span>
          )}
          {check?.hasUpdate && check.latest && (
            <>
              <Badge variant="info">发现新版本 {check.latest.version}</Badge>
              <Button
                disabled={!info.updaterOnline || busy}
                onClick={() => setConfirmOpen(true)}
              >
                升级到 {check.latest.version}
              </Button>
            </>
          )}
        </div>

        {check?.hasUpdate && check.latest?.notes && (
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
            {check.latest.notes}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">备份</h2>
          <Button variant="secondary" disabled={busy || !info.updaterOnline} onClick={() => void runBackup()}>
            立即备份
          </Button>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          备份数据库与上传文件到服务器的备份目录。升级前会自动备份一次。
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">任务记录</h2>
        {activeJob && (
          <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-foreground">
                {activeJob.step ?? '处理中'}（{activeJob.progress}%）
              </span>
              <Badge variant="warning">{JOB_STATUS_META[activeJob.status].label}</Badge>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${activeJob.progress}%` }}
              />
            </div>
          </div>
        )}
        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">暂无任务记录。</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {jobs.slice(0, 8).map((job) => {
              const meta = JOB_STATUS_META[job.status];
              return (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      {job.action === 'upgrade'
                        ? `升级到 ${job.payloadVersion ?? '新版本'}`
                        : job.action === 'backup'
                          ? '备份'
                          : job.action}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString('zh-CN')}
                      {job.finishedAt ? ` → ${new Date(job.finishedAt).toLocaleString('zh-CN')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => setOpenLog(job.id)}>
                      日志
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <Dialog open={confirmOpen} onOpenChange={(next) => !next && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader className="mb-3">
            <DialogTitle>确认升级到 {check?.latest?.version}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>升级会重新构建并重启应用，期间商城可能有数十秒不可用。</p>
            <p>开始前会自动备份；任一步失败都会自动回滚到当前版本（{info.version}）。</p>
            <p className="text-xs">请确认现在不是营业高峰，再继续。</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void runUpgrade()}>
              {busy ? '提交中…' : '确认升级'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openLog !== null} onOpenChange={(next) => !next && setOpenLog(null)}>
        <DialogContent>
          <DialogHeader className="mb-3">
            <DialogTitle>任务日志</DialogTitle>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5 text-foreground">
            {jobs.find((j) => j.id === openLog)?.log ?? '（无日志）'}
            {jobs.find((j) => j.id === openLog)?.error
              ? `\n\n错误：${jobs.find((j) => j.id === openLog)?.error}`
              : ''}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-foreground">{value || '—'}</p>
    </div>
  );
}
