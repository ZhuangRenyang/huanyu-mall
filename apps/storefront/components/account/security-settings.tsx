'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@mall/ui';
import { changePassword } from '@/lib/account';

/**
 * 账号安全（ADR-055）：修改登录密码。
 *
 * 之前顾客想换密码只有「忘记密码」一条路：收验证码、再重设 ——
 * 明明是记得密码的正常操作，却被逼成「找回」流程。
 *
 * 改密成功后服务端撤销该身份的全部会话（安全底线：密码变了，旧设备立刻失效），
 * 所以这里必须把「已登录」状态一起清掉，并引导重新登录。
 */
export function SecuritySettings({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = () => {
    if (next.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    setError(null);
    void changePassword({ currentPassword: current, newPassword: next })
      .then(() => {
        setDone(true);
        setCurrent('');
        setNext('');
        setConfirm('');
        // 会话已被服务端撤销：让父组件把「已登录」也清掉
        onChanged();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '修改失败'))
      .finally(() => setBusy(false));
  };

  return (
    <section
      aria-labelledby="security-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="security-heading" className="text-base font-semibold text-foreground">
          账号安全
        </h2>
        {!open && !done && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <KeyRound className="size-3.5" strokeWidth={2} aria-hidden="true" />
            修改密码
          </Button>
        )}
      </div>

      {done && (
        <p className="mt-2 text-sm text-success" role="status">
          密码已修改，所有设备已退出登录。请用新密码重新登录。
        </p>
      )}

      {open && !done && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-muted-foreground">
            当前密码
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            新密码（至少 8 位）
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            再输入一次新密码
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !current || !next || !confirm}
              onClick={submit}
            >
              {busy ? '提交中…' : '确认修改'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
