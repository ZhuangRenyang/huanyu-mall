import { useEffect, useState } from 'react';
import { Badge, Button, cn } from '@mall/ui';
import {
  getAuthSettings,
  saveAuthSettings,
  type RegisterMode,
} from '@/lib/admin-auth-settings';

interface Option {
  value: RegisterMode;
  title: string;
  tagline: string;
  /** 顾客在注册页会看到什么（照着填一遍就知道该选哪个）。 */
  fields: string[];
  /** 适合谁开这家店。 */
  fit: string;
}

const OPTIONS: Option[] = [
  {
    value: 'email',
    title: '邮箱注册',
    tagline: '邮箱 + 密码，注册后可直接登录',
    fields: ['邮箱', '密码', '手机号（必填）', '验证码（发到邮箱或手机）'],
    fit: '独立站 / 面向海外：顾客习惯用邮箱当账号，换设备也能记住。',
  },
  {
    value: 'phone',
    title: '手机号注册',
    tagline: '手机号 + 验证码，注册即登录',
    fields: ['手机号', '验证码'],
    fit: '面向国内：顾客不愿记密码，输一次验证码就是注册 + 登录。',
  },
];

/**
 * 顾客账号设置：注册方式（ADR-025）。
 *
 * 两种都是成熟做法（Shopify 用邮箱、淘宝用手机号），选哪种取决于店铺面向谁，
 * 所以做成商家可切换的店铺设置，而不是代码里写死一种。
 *
 * 登录不跟着这个开关走：邮箱注册的账号也能用手机号 + 密码登录，
 * 顾客不该因为当初填了哪个字段而被锁在门外。
 */
export function CustomerAccountSettings() {
  const [mode, setMode] = useState<RegisterMode>('email');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getAuthSettings()
      .then((v) => setMode(v.registerMode))
      .catch(() => setError('读取顾客账号设置失败'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (next: RegisterMode) => {
    setMode(next);
    setSaving(true);
    setError(null);
    try {
      await saveAuthSettings({ registerMode: next });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">正在读取顾客账号设置…</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">顾客注册方式</h2>
        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
          决定店面「注册」页显示哪种表单。登录方式不受影响：两种账号都能用邮箱或手机号登录。
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              disabled={saving}
              onClick={() => void save(opt.value)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors duration-150',
                active
                  ? 'border-primary bg-primary-subtle'
                  : 'border-border bg-card hover:bg-muted',
                saving && 'opacity-70',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{opt.title}</span>
                {active && <Badge variant="success">当前使用</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{opt.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-foreground">
                {opt.fields.map((f) => (
                  <li key={f} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-1 rounded-full bg-muted-foreground" />
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">{opt.fit}</p>
            </button>
          );
        })}
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">验证码怎么发</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
          <li>
            · 邮箱注册：验证码可以发到<strong className="text-foreground">邮箱</strong>，也可以发到
            <strong className="text-foreground">手机号</strong>，顾客自己选。
          </li>
          <li>· 手机号注册：验证码只发手机短信。</li>
          <li>
            · 短信要在服务器配置短信服务商；邮件复用「通知」页里的 SMTP 设置 ——
            两边都没配时，发码接口会明确报错，不会假装发出去了。
          </li>
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {saving && <span className="text-xs text-muted-foreground">保存中…</span>}
        {saved && (
          <span className="text-xs text-success" role="status">
            已保存
          </span>
        )}
        {error && (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
        {!saving && !saved && !error && (
          <span className="text-xs text-muted-foreground">点选即保存，无需额外提交。</span>
        )}
      </div>
    </div>
  );
}
