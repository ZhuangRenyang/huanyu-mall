import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button, cn } from '@mall/ui';
import { SelectField, TextField } from './field';
import { getTheme, saveTheme, uploadImageAsset } from '@/lib/admin-api';
import { DEFAULT_THEME, FONT_PRESETS, THEME_PRESETS, type ThemeConfig } from '@/lib/admin-data';

const SHADOWS: { value: ThemeConfig['shadow']; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'light', label: '轻' },
  { value: 'medium', label: '中' },
];
const RATIOS: ThemeConfig['productRatio'][] = ['1:1', '4:5', '3:4'];

export function ThemeSettings() {
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    void getTheme().then(setTheme);
  }, []);

  const set = <K extends keyof ThemeConfig>(key: K, value: ThemeConfig[K]) => {
    setTheme((t) => ({ ...t, [key]: value }));
    setSaved(false);
  };
  const save = async () => {
    await saveTheme(theme);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };
  const reset = async () => {
    if (window.confirm('恢复默认外观？当前未保存的调整将丢失。')) {
      setTheme(DEFAULT_THEME);
      await saveTheme(DEFAULT_THEME);
    }
  };

  /** 上传 logo：先拿到 file_id 与预览 URL，保存外观时才落库（与配色同样的交互）。 */
  const onLogoPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const asset = await uploadImageAsset(file);
      set('logoFileId', asset.fileId);
      set('logoUrl', asset.url ?? null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const preset = THEME_PRESETS.find((p) => p.id === theme.primaryColor) ?? THEME_PRESETS[0];
  const font = FONT_PRESETS.find((f) => f.id === theme.fontPreset) ?? FONT_PRESETS[0];

  const previewStyle = {
    '--primary': preset.value,
    '--primary-hover': `color-mix(in srgb, ${preset.value} 82%, black)`,
    '--primary-active': `color-mix(in srgb, ${preset.value} 68%, black)`,
    '--primary-subtle': `color-mix(in srgb, ${preset.value} 12%, white)`,
    '--primary-subtle-foreground': preset.value,
    '--radius': `${theme.radius}px`,
    '--product-ratio-primary': theme.productRatio.replace(':', ' / '),
    fontFamily: font.stack,
  } as React.CSSProperties;

  const previewShadow = theme.shadow === 'none' ? '' : theme.shadow === 'light' ? 'shadow-sm' : 'shadow-md';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5 rounded-lg border border-border bg-card p-4">
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">品牌主色</p>
          <div className="flex flex-wrap gap-2">
            {THEME_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-label={p.name}
                aria-pressed={theme.primaryColor === p.id}
                onClick={() => set('primaryColor', p.id)}
                className={cn(
                  'grid size-8 place-items-center rounded-md border-2 transition-colors duration-150',
                  theme.primaryColor === p.id ? 'border-foreground' : 'border-transparent',
                )}
                style={{ backgroundColor: p.value }}
              >
                {theme.primaryColor === p.id && <Check className="size-4 text-white" strokeWidth={3} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>

        <SelectField
          id="theme-font"
          label="字体预设"
          value={theme.fontPreset}
          onChange={(e) => set('fontPreset', e.target.value)}
          options={FONT_PRESETS.map((f) => ({ value: f.id, label: f.name }))}
        />

        <div>
          <label htmlFor="theme-radius" className="mb-1 flex items-center justify-between text-sm font-medium text-foreground">
            <span>圆角</span>
            <span className="tabular text-muted-foreground">{theme.radius}px</span>
          </label>
          <input
            id="theme-radius"
            type="range"
            min={4}
            max={12}
            step={2}
            value={theme.radius}
            aria-valuemin={4}
            aria-valuemax={12}
            aria-valuenow={theme.radius}
            onChange={(e) => set('radius', Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">阴影强度</p>
          <div className="flex gap-2">
            {SHADOWS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={theme.shadow === o.value}
                onClick={() => set('shadow', o.value)}
                className={cn(
                  'h-8 rounded-md px-3 text-sm transition-colors duration-150',
                  theme.shadow === o.value ? 'bg-primary-subtle font-medium text-primary-subtle-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">商品图比例</p>
          <div className="flex gap-2">
            {RATIOS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={theme.productRatio === r}
                onClick={() => set('productRatio', r)}
                className={cn(
                  'h-8 rounded-md px-3 text-sm transition-colors duration-150',
                  theme.productRatio === r ? 'bg-primary-subtle font-medium text-primary-subtle-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">店铺 Logo</p>
          <p className="text-xs text-muted-foreground">
            显示在店头（左上角）与页脚；不上传则显示店铺名称文字。建议横向 PNG，高 64px 以上。
          </p>
          <div className="flex items-center gap-3">
            {theme.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 后台预览，尺寸固定
              <img
                src={theme.logoUrl}
                alt="店铺 Logo"
                className="h-10 max-w-[160px] rounded border border-border object-contain"
              />
            ) : (
              <div className="grid h-10 w-24 place-items-center rounded border border-dashed border-border text-xs text-muted-foreground">
                无 Logo
              </div>
            )}
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border px-3 text-sm text-foreground transition-colors duration-150 hover:bg-muted">
              {uploading ? '上传中…' : theme.logoUrl ? '更换' : '上传'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => void onLogoPick(e.target.files?.[0])}
              />
            </label>
            {theme.logoUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  set('logoFileId', null);
                  set('logoUrl', null);
                }}
              >
                移除
              </Button>
            )}
          </div>
          {uploadError && (
            <p className="text-xs text-destructive" role="alert">
              {uploadError}
            </p>
          )}
        </div>

        <TextField
          id="theme-announce"
          label="首页通告条"
          placeholder="单行 ≤40 字，选填"
          maxLength={40}
          value={theme.announcement}
          onChange={(e) => set('announcement', e.target.value)}
        />

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Button onClick={save}>保存并预览</Button>
          <Button variant="ghost" onClick={reset}>
            恢复默认
          </Button>
          {saved && (
            <span className="text-xs text-success" role="status">
              已保存
            </span>
          )}
        </div>
      </div>

      <aside className="space-y-3">
        <p className="text-sm font-medium text-foreground">实时预览</p>
        <div className="rounded-lg border border-border bg-card p-4" style={previewStyle}>
          <div className={cn('rounded-lg border border-border bg-card p-3', previewShadow)}>
            <div className="grid aspect-product w-full place-items-center rounded-md bg-secondary text-xs text-muted-foreground">商品图</div>
            <p className="mt-2 text-sm font-medium text-foreground">示例商品名</p>
            <p className="tabular text-base font-semibold text-primary">¥199.00</p>
            <Button size="sm" className="mt-2 w-full">
              立即购买
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-3 rounded-full bg-primary" aria-hidden="true" />
            <span className="size-3 rounded-full bg-accent-orange" aria-hidden="true" />
            <span className="size-3 rounded-full bg-success" aria-hidden="true" />
            <span>色板联动预览</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
