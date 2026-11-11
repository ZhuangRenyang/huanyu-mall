import { useEffect, useState } from 'react';
import { Badge, Switch } from '@mall/ui';
import { getMarketingFeatures, setMarketingFeature } from '@/lib/admin-api';
import type { MarketingFeature } from '@/lib/admin-api';

/**
 * 功能级总开关：放在每个营销页顶部，管的是「这个功能整体开不开」。
 *
 * 默认关闭（ADR-014 / 用户要求）：新装商城不会因为历史活动自动打折，
 * 商家确认要用了再打开。关闭不影响历史订单，也不删除任何活动。
 */
export function MarketingFeatureSwitch({
  feature,
  title,
  description,
}: {
  feature: MarketingFeature;
  title: string;
  description: string;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getMarketingFeatures()
      .then((flags) => alive && setEnabled(flags[feature]))
      .catch(() => alive && setEnabled(false));
    return () => {
      alive = false;
    };
  }, [feature]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    const prev = enabled;
    setEnabled(next);
    try {
      await setMarketingFeature(feature, next);
    } catch (err) {
      setEnabled(prev ?? false);
      setError(err instanceof Error ? err.message : '开关保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {enabled === null ? null : enabled ? (
            <Badge variant="success">已开启</Badge>
          ) : (
            <Badge variant="neutral">已关闭</Badge>
          )}
        </div>
        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p>
        {enabled === false && (
          <p className="mt-1 text-xs text-accent-orange-deep" role="status">
            当前关闭：下列活动不会参与结算，也不会出现在店面。
          </p>
        )}
        {error && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{enabled ? '开启' : '关闭'}</span>
        <Switch
          checked={Boolean(enabled)}
          disabled={enabled === null || saving}
          onCheckedChange={(next) => void toggle(next)}
          aria-label={`${title}${enabled ? '关闭' : '开启'}`}
        />
      </div>
    </section>
  );
}
