'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Users } from 'lucide-react';
import { Badge, Button, formatMoney } from '@mall/ui';
import {
  claimGroupBuyVoucher,
  joinGroupBuy,
  loadMyGroupBuys,
  type StoreGroupBuy,
  type StoreGroupBuyTeam,
} from '@/lib/group-buys';

/**
 * 拼团看板（ADR-100）。
 *
 * 参团免费：点「参团」只占一个名额，不收钱也不建订单；
 * 人齐后点「领取拼团券」，拿券去下单 —— 所以未成团不需要任何退款动作。
 */
export function GroupBuyBoard({ activities }: { activities: StoreGroupBuy[] }) {
  const [teams, setTeams] = useState<Record<string, StoreGroupBuyTeam>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshMine = async () => {
    const mine = await loadMyGroupBuys();
    const map: Record<string, StoreGroupBuyTeam> = {};
    for (const item of mine) map[item.groupBuy.id] = item.team;
    setTeams(map);
  };

  useEffect(() => {
    void refreshMine();
  }, []);

  const join = async (activity: StoreGroupBuy) => {
    setBusyId(activity.id);
    setError(null);
    setNotice(null);
    try {
      const team = await joinGroupBuy(activity.id);
      setTeams((prev) => ({ ...prev, [activity.id]: team }));
      setNotice(
        team.status === 'success'
          ? '已成团！可以领取拼团券了'
          : `已参团：${team.memberCount}/${team.teamSize} 人，等人凑齐`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '参团失败，请先登录');
    } finally {
      setBusyId(null);
    }
  };

  const claim = async (activity: StoreGroupBuy) => {
    setBusyId(activity.id);
    setError(null);
    try {
      const code = await claimGroupBuyVoucher(activity.id);
      setCodes((prev) => ({ ...prev, [activity.id]: code }));
      setNotice('已领到拼团券，去「我的卡券」查看，下单时自动可用');
    } catch (err) {
      setError(err instanceof Error ? err.message : '领券失败');
    } finally {
      setBusyId(null);
    }
  };

  if (activities.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm text-foreground">暂时没有进行中的拼团</p>
        <p className="mt-1 text-xs text-muted-foreground">新活动开始时会出现在这里</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-success" role="status">
          {notice}
        </p>
      )}

      <ul className="space-y-3">
        {activities.map((a) => {
          const team = teams[a.id];
          const code = codes[a.id];
          return (
            <li key={a.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{a.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.title}</p>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="tabular text-lg font-semibold text-accent-orange">
                    {formatMoney(a.groupPriceMinor, 'CNY')}
                  </span>
                  <span className="tabular text-xs text-muted-foreground line-through">
                    {formatMoney(a.originalPriceMinor, 'CNY')}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="neutral">
                  <Users className="mr-1 size-3" strokeWidth={2} aria-hidden="true" />
                  {a.teamSize} 人成团
                </Badge>
                {team && (
                  <Badge
                    variant={
                      team.status === 'success'
                        ? 'success'
                        : team.status === 'expired'
                          ? 'neutral'
                          : 'warning'
                    }
                  >
                    {team.status === 'success'
                      ? '已成团'
                      : team.status === 'expired'
                        ? '已过期'
                        : `${team.memberCount}/${team.teamSize} 人`}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">截止 {formatDeadline(a.endsAt)}</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!team && (
                  <Button size="sm" disabled={busyId === a.id} onClick={() => void join(a)}>
                    {busyId === a.id ? '处理中…' : '参团'}
                  </Button>
                )}
                {team?.status === 'forming' && (
                  <p className="text-xs text-muted-foreground">
                    已参团，等其他人加入；凑齐 {team.teamSize} 人即可领券。
                  </p>
                )}
                {team?.status === 'expired' && (
                  <Button size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => void join(a)}>
                    重新参团
                  </Button>
                )}
                {team?.status === 'success' && !code && (
                  <Button size="sm" disabled={busyId === a.id} onClick={() => void claim(a)}>
                    <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    {busyId === a.id ? '领取中…' : '领取拼团券'}
                  </Button>
                )}
                {code && (
                  <span className="flex items-center gap-1.5 rounded-md bg-success-subtle px-2 py-1 text-xs text-success">
                    拼团券 <span className="font-mono">{code}</span>
                    <button
                      type="button"
                      aria-label="复制券码"
                      onClick={() => void navigator.clipboard.writeText(code).catch(() => {})}
                      className="text-success/80 hover:text-success"
                    >
                      <Copy className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
