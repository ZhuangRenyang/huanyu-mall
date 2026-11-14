import { useCallback, useEffect, useState } from 'react';
import { Award, Pencil, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  formatMoney,
} from '@mall/ui';
import {
  createMemberLevel,
  listMemberLevels,
  updateMemberLevel,
  type MemberLevelView,
} from '@/lib/admin-member-levels';
import { yuanToMinor } from '@/lib/admin-shipping';

/**
 * 会员等级（ADR-102，对齐 CRMEB「会员 → 会员等级」）。
 *
 * 等级只做两件事：给名字、给折扣。归属由**累计消费**自动匹配（读时计算），
 * 改完规则顾客下次进店就按新规则走，不需要刷数据。
 *
 * 折扣力度上限 30%：再高不是会员权益，是清仓。
 */
export function MemberLevelsPage() {
  const [levels, setLevels] = useState<MemberLevelView[]>([]);
  const [editing, setEditing] = useState<MemberLevelView | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLevels(await listMemberLevels());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">会员等级</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            按<strong className="font-medium text-foreground">累计消费</strong>
            自动匹配等级，下单时按等级折扣减价（与商品促销取较大者，不叠加）。
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          新增等级
        </Button>
      </div>

      {flash && (
        <p className="text-xs text-success" role="status">
          {flash}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {levels.length === 0 ? (
        <EmptyState
          icon={Award}
          title="还没有会员等级"
          description="先加一档「普通会员」作为兜底，再往上加银卡、金卡"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">等级</th>
                <th scope="col" className="px-4 py-3 font-medium">累计消费门槛</th>
                <th scope="col" className="px-4 py-3 font-medium">会员折扣</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {levels.map((level, i) => (
                <tr key={level.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 text-foreground">
                      <Badge variant={i === levels.length - 1 ? 'promo' : 'neutral'}>{level.name}</Badge>
                    </span>
                  </td>
                  <td className="tabular px-4 py-3">
                    {level.thresholdMinor === 0 ? '无门槛' : formatMoney(level.thresholdMinor, 'CNY')}
                  </td>
                  <td className="tabular px-4 py-3">
                    {(level.discountBps / 100).toFixed(2).replace(/\.?0+$/, '')}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(level)}>
                      <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" />
                      编辑
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        说明：折扣按行计算（与商品折扣取较大者），不会和商品促销叠加；
        秒杀价商品按秒杀价再算会员折扣。
      </p>

      {editing && (
        <LevelDialog
          level={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            setFlash(msg);
            await load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function LevelDialog({
  level,
  onClose,
  onSaved,
  onError,
}: {
  level: MemberLevelView | null;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(level?.name ?? '');
  const [threshold, setThreshold] = useState(
    level ? String(level.thresholdMinor / 100) : '0',
  );
  const [rate, setRate] = useState(level ? String(level.discountBps / 100) : '1');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (name.trim() === '') return onError('请填写等级名称');
    const pct = Number(rate);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 30) return onError('折扣需在 0.01%–30% 之间');
    const thresholdMinor = yuanToMinor(threshold || '0');
    if (!Number.isFinite(thresholdMinor) || thresholdMinor < 0) return onError('门槛金额不正确');

    setBusy(true);
    onError('');
    try {
      if (level) {
        await updateMemberLevel(level.id, {
          name: name.trim(),
          thresholdMinor,
          discountBps: Math.round(pct * 100),
        });
        await onSaved('等级已更新，顾客下次进店即按新规则');
      } else {
        await createMemberLevel({
          name: name.trim(),
          thresholdMinor,
          discountBps: Math.round(pct * 100),
        });
        await onSaved('等级已新增');
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{level ? '编辑会员等级' : '新增会员等级'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">
            等级名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：银卡会员"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            累计消费门槛（元）
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            会员折扣（%）
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="5"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            门槛唯一：两档相同门槛，顾客算哪一档没有答案。折扣上限 30%。
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
