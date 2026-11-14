import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Palette } from 'lucide-react';
import { Badge, Button } from '@mall/ui';
import { ThemeSettings } from '@/components/settings-theme';
import {
  getHomeModules,
  saveHomeModules,
  type HomeModuleId,
  type HomeModuleView,
} from '@/lib/admin-settings';

/**
 * 装修（ADR-077 / ADR-079）。
 *
 * 一、主题外观：品牌色、字体、圆角、Logo、公告（保存后店面即生效）。
 * 二、首页模块：哪些区块显示、按什么顺序（搜索固定在首屏，不参与排序）。
 *
 * 不做「自由拖拽画布」：拖拽版页面设计器是独立产品级能力，
 * 三个模块用上移/下移已经能表达顺序，先把闭环跑通。
 */
export function DesignPage() {
  const [modules, setModules] = useState<HomeModuleView[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setModules(await getHomeModules());
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取首页模块失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const move = (id: HomeModuleId, direction: 'up' | 'down') => {
    setModules((prev) => {
      const index = prev.findIndex((m) => m.id === id);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSaved(false);
  };

  const toggle = (id: HomeModuleId) => {
    setModules((prev) => prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveHomeModules(modules);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Palette className="size-5" strokeWidth={2} aria-hidden="true" />
          装修
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          改的是店面的样子：品牌色、字体、圆角、Logo、公告，以及首页区块的顺序。
        </p>
      </div>

      <ThemeSettings />

      <section aria-labelledby="home-modules-heading" className="max-w-2xl rounded-lg border border-border bg-card p-4">
        <h2 id="home-modules-heading" className="text-sm font-semibold text-foreground">
          首页模块
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          搜索固定在最前（顾客最常用的动作），其余按下面的顺序显示。关掉即整段不出现。
        </p>

        <ul className="mt-3 space-y-2">
          {modules.map((m, i) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{MODULE_LABEL[m.id]}</span>
                {!m.enabled && <Badge variant="neutral">已隐藏</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`上移${MODULE_LABEL[m.id]}`}
                  disabled={i === 0}
                  onClick={() => move(m.id, 'up')}
                  className="rounded-md border border-border p-1.5 text-muted-foreground disabled:opacity-40"
                >
                  <ArrowUp className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`下移${MODULE_LABEL[m.id]}`}
                  disabled={i === modules.length - 1}
                  onClick={() => move(m.id, 'down')}
                  className="rounded-md border border-border p-1.5 text-muted-foreground disabled:opacity-40"
                >
                  <ArrowDown className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
                <label className="ml-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    onChange={() => toggle(m.id)}
                    className="size-4 accent-primary"
                  />
                  显示
                </label>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={() => void save()} disabled={saving || modules.length === 0}>
            {saving ? '保存中…' : '保存首页模块'}
          </Button>
          {saved && (
            <span className="text-xs text-success" role="status">
              已保存，店面刷新即生效
            </span>
          )}
          {error && (
            <span className="text-xs text-destructive" role="alert">
              {error}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

const MODULE_LABEL: Record<HomeModuleId, string> = {
  categories: '商品分类',
  vouchers: '优惠券条',
  featured: '当季主推（商品流）',
};
