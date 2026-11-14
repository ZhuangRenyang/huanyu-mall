import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Database, Mail, RefreshCw } from 'lucide-react';
import { Badge, Button, Skeleton } from '@mall/ui';
import { getMaintenance, type MaintenanceView, type ProbeState } from '@/lib/admin-maintenance';

/**
 * 维护（ADR-076）。
 *
 * 对齐 CRMEB「设置 → 维护」那一组：系统信息 / 系统日志 / 数据备份。
 * 只读 —— 本仓没有页面缓存层，也没有远程升级通道，
 * 放三个点了没反应的按钮比没有这个页面更坏。
 */
export function MaintenancePage() {
  const [data, setData] = useState<MaintenanceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getMaintenance());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取维护信息失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive" role="alert">
          {error ?? '读取维护信息失败'}
        </p>
        <Button variant="secondary" onClick={() => void refresh()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">维护</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            系统是否正常、邮件有没有堵、数据有多少。只读，不会改动任何数据。
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className="mr-1 size-4" strokeWidth={2} aria-hidden="true" />
          {loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {data.demo && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          演示模式：以下数字为本地占位，未连接真实数据库与 Redis。
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Database className="size-4" strokeWidth={2} aria-hidden="true" />
            运行状态
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <ProbeRow label="整体" state={data.system.status} />
            <ProbeRow label="数据库" state={data.system.db} />
            <ProbeRow label="Redis" state={data.system.redis} />
            <ProbeRow label="队列" state={data.system.queue} />
          </ul>
          <dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>最新迁移</dt>
              <dd className="truncate font-mono text-foreground">{data.system.migrations}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>运行时长</dt>
              <dd className="text-foreground">{formatUptime(data.system.uptime)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Node / 环境</dt>
              <dd className="text-foreground">
                {data.system.node} · {data.system.env}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Mail className="size-4" strokeWidth={2} aria-hidden="true" />
            邮件队列
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Metric label="待发" value={data.mail.pending} />
            <Metric label="失败" value={data.mail.failed} tone={data.mail.failed > 0} />
            <Metric label="已发" value={data.mail.sent} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {data.mail.failed > 0
              ? '有发送失败的信：去「设置 → 通知」检查 SMTP 后逐条重发。失败不会自动清空，会一直留在这里。'
              : '没有发送失败的信。待发数量包含正在排队的通知。'}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">数据规模</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <DataRow label="订单" value={data.data.orders} />
            <DataRow label="商品" value={data.data.products} />
            <DataRow label="客户" value={data.data.customers} />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            只用于判断「这是不是一个活店」，不做趋势与同比。
          </p>
        </section>
      </div>

      <section aria-labelledby="audit-heading" className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="audit-heading" className="text-sm font-semibold text-foreground">
            最近操作
          </h2>
          <span className="text-xs text-muted-foreground">共 {data.audit.count} 条审计记录</span>
        </div>
        {data.audit.recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            还没有审计记录。改商品、发货、退款都会在这里留痕。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">时间</th>
                  <th scope="col" className="px-4 py-2 font-medium">动作</th>
                  <th scope="col" className="px-4 py-2 font-medium">对象</th>
                  <th scope="col" className="px-4 py-2 font-medium">操作者</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.audit.recent.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                      {formatTime(row.createdAt)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-foreground">{row.action}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {row.entityType}
                      {row.entityId ? ` · ${row.entityId}` : ''}
                    </td>
                    <td className="px-4 py-2 text-xs text-foreground">{row.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="backup-heading" className="rounded-lg border border-border bg-card p-4">
        <h2 id="backup-heading" className="text-sm font-semibold text-foreground">
          数据备份与恢复
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          备份在服务器上执行，不在浏览器里跑 —— 浏览器拿不到数据库凭据，也不该拿到。
          命令与恢复演练步骤见仓库 <code className="font-mono text-xs">deploy/scripts/</code>：
        </p>
        <ul className="mt-2 space-y-1 font-mono text-xs text-foreground">
          <li>bash deploy/scripts/backup.sh</li>
          <li>bash deploy/scripts/restore.sh &lt;备份文件&gt;</li>
          <li>bash deploy/scripts/doctor.sh</li>
        </ul>
        <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
          恢复前先做一次新备份；恢复会覆盖当前数据，属于不可逆操作。
        </p>
      </section>
    </div>
  );
}

function ProbeRow({ label, state }: { label: string; state: ProbeState }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={state === 'ok' ? 'success' : 'destructive'}>
        {state === 'ok' ? '正常' : '异常'}
      </Badge>
    </li>
  );
}

function Metric({ label, value, tone = false }: { label: string; value: number; tone?: boolean }) {
  return (
    <div className={tone ? 'rounded-md bg-accent-orange/10 px-2 py-2' : 'rounded-md bg-muted px-2 py-2'}>
      <p className={tone ? 'tabular text-xl font-semibold text-accent-orange-deep' : 'tabular text-xl font-semibold text-foreground'}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium text-foreground">{value}</dd>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN');
}
