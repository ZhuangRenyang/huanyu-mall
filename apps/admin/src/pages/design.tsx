import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Palette } from 'lucide-react';
import { Badge, Button } from '@mall/ui';
import { ThemeSettings } from '@/components/settings-theme';
import {
  addBanner,
  getHomeModules,
  listBanners,
  removeBanner,
  saveHomeModules,
  searchLinkTargets,
  setBannerActive,
  type BannerView,
  type HomeModuleId,
  type HomeModuleView,
} from '@/lib/admin-settings';
import { uploadImageAsset } from '@/lib/admin-catalog';

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

      <BannerSection />
    </div>
  );
}

/** 首页轮播（ADR-080）：上传图 + 站内路径/https 链接；链接白名单在服务端。 */
function BannerSection() {
  const [banners, setBanners] = useState<BannerView[]>([]);
  const [fileId, setFileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 链接选择器（ADR-081）：先搜再点，不让商家手打前缀。 */
  const [targetType, setTargetType] = useState<'product' | 'category'>('product');
  const [keyword, setKeyword] = useState('');
  const [targets, setTargets] = useState<Array<{ id: string; label: string; href: string }>>([]);

  const load = useCallback(async () => {
    try {
      setBanners(await listBanners());
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取轮播图失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const uploaded = await uploadImageAsset(file);
      setFileId(uploaded.fileId);
      setPreview(uploaded.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    }
  };

  const add = async () => {
    if (!fileId) {
      setError('先选一张图片');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addBanner(fileId, link);
      setFileId(null);
      setPreview(null);
      setLink('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="banner-heading" className="max-w-2xl rounded-lg border border-border bg-card p-4">
      <h2 id="banner-heading" className="text-sm font-semibold text-foreground">
        首页轮播
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        显示在搜索框下方。链接只接受站内路径（以 / 开头）或 https 外链，留空则不可点。
      </p>

      <ul className="mt-3 space-y-2">
        {banners.map((b) => (
          <li key={b.id} className="flex items-center gap-3 rounded-md border border-border p-2">
            {b.imageUrl ? (
              <img src={b.imageUrl} alt="" className="h-14 w-24 rounded object-cover" />
            ) : (
              <div className="h-14 w-24 rounded bg-muted" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground">{b.link ?? '不可点'}</p>
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={b.isActive}
                onChange={(e) => void setBannerActive(b.id, e.target.checked).then(load)}
                className="size-4 accent-primary"
              />
              显示
            </label>
            <button
              type="button"
              onClick={() => void removeBanner(b.id).then(load)}
              className="text-xs text-destructive hover:underline"
            >
              删除
            </button>
          </li>
        ))}
        {banners.length === 0 && <li className="text-xs text-muted-foreground">还没有轮播图。</li>}
      </ul>

      <div className="mt-4 space-y-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => void pick(e.target.files?.[0])}
            className="text-xs text-muted-foreground"
          />
          {preview && <img src={preview} alt="" className="h-12 w-20 rounded object-cover" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as 'product' | 'category')}
            className="rounded-md border border-border px-2 py-1.5 text-xs"
            aria-label="链接类型"
          >
            <option value="product">商品</option>
            <option value="category">分类</option>
          </select>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜商品/分类名"
            className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs"
          />
          <Button
            variant="secondary"
            onClick={() => void searchLinkTargets(targetType, keyword).then(setTargets)}
          >
            查找
          </Button>
        </div>
        {targets.length > 0 && (
          <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {targets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setLink(t.href);
                    setTargets([]);
                  }}
                  className="w-full truncate rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted"
                >
                  {t.label} · {t.href}
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="链接：/zh-CN/cn/products 或 https://…（可留空）"
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2">
          <Button onClick={() => void add()} disabled={busy}>
            {busy ? '添加中…' : '添加轮播图'}
          </Button>
          {error && (
            <span className="text-xs text-destructive" role="alert">
              {error}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

const MODULE_LABEL: Record<HomeModuleId, string> = {
  categories: '商品分类',
  vouchers: '优惠券条',
  featured: '当季主推（商品流）',
};
