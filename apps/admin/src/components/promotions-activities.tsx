import { useCallback, useEffect, useState } from 'react';
import { PowerOff } from 'lucide-react';
import { Badge, Button, Switch, cn } from '@mall/ui';
import { SelectField } from './field';
import {
  ACTIVITY_KIND_LABEL,
  disableAllActivities,
  listActivities,
  setActivityActive,
} from '@/lib/admin-api';
import type { ActivityKind, ActivityView } from '@/lib/admin-api';

type KindFilter = 'all' | ActivityKind;
type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * 活动总览：一张列表管住所有营销入口的开关。
 *
 * 只做「看 + 开关」：新建/编辑仍在各自的页面里，避免在这一页堆表单。
 */
export function ActivityOverview() {
  const [items, setItems] = useState<ActivityView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [pending, setPending] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listActivities());
    } catch (err) {
      setError(err instanceof Error ? err.message : '活动列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeCount = items.filter((i) => i.active).length;
  const filtered = items.filter(
    (i) => (kind === 'all' || i.kind === kind) && (status === 'all' || (status === 'active' ? i.active : !i.active)),
  );

  const toggle = async (item: ActivityView, next: boolean) => {
    setPending(item.key);
    setError(null);
    try {
      await setActivityActive(item, next);
      setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, active: next } : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '开关切换失败，请稍后重试');
    } finally {
      setPending(null);
    }
  };

  const disableAll = async () => {
    if (activeCount === 0) return;
    if (!window.confirm(`停用全部 ${activeCount} 个启用中的活动？停用后立即不再命中新订单，历史订单留痕不受影响。`)) {
      return;
    }
    setBulkBusy(true);
    setError(null);
    try {
      await disableAllActivities(items);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量停用失败，可能有活动未停用，请刷新确认');
      await refresh();
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            所有营销入口集中在这里开关。停用即时生效，历史订单的折扣记录不受影响。
          </p>
          <p className="mt-1 text-xs text-muted-foreground" role="status">
            共 {items.length} 个活动 · 启用 {activeCount} · 停用 {items.length - activeCount}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void disableAll()} disabled={activeCount === 0 || bulkBusy}>
          <PowerOff className="size-4" strokeWidth={2} aria-hidden="true" />
          {bulkBusy ? '停用中…' : '全部停用'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <SelectField
          id="act-kind"
          label="类型"
          value={kind}
          onChange={(e) => setKind(e.target.value as KindFilter)}
          options={[
            { value: 'all', label: '全部类型' },
            { value: 'promotion', label: '促销（自动满减/折扣）' },
            { value: 'voucher', label: '优惠券' },
            { value: 'gift_card', label: '礼品卡' },
          ]}
        />
        <SelectField
          id="act-status"
          label="状态"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'active', label: '启用中' },
            { value: 'inactive', label: '已停用' },
          ]}
        />
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">活动</th>
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 font-medium">优惠</th>
              <th className="px-4 py-3 font-medium">有效期</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 text-right font-medium">开关</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((item) => (
              <tr key={item.key} className="transition-colors duration-150 hover:bg-muted/50">
                <td className="px-4 py-3 font-medium text-foreground">{item.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{ACTIVITY_KIND_LABEL[item.kind]}</td>
                <td className={cn('px-4 py-3', item.active ? 'text-foreground' : 'text-muted-foreground')}>
                  {item.summary}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{item.note}</td>
                <td className="px-4 py-3">
                  {item.active ? <Badge variant="success">启用中</Badge> : <Badge variant="neutral">已停用</Badge>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <Switch
                      checked={item.active}
                      disabled={pending === item.key || bulkBusy}
                      onCheckedChange={(next) => void toggle(item, next)}
                      aria-label={`${item.active ? '停用' : '启用'} ${item.name}`}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {items.length === 0 ? '还没有任何活动' : '当前筛选下没有活动'}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  加载中…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
