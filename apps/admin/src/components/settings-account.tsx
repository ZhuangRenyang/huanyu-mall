import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Circle, KeyRound } from 'lucide-react';
import { PASSWORD_RULES } from '@mall/policy';
import { Button, cn } from '@mall/ui';
import { TextField } from '@/components/field';
import { changePassword, logout } from '@/lib/admin-api';
import { setAuthNotice } from '@/lib/admin-notice';

/** 字段级错误：哪一栏出错就落在哪一栏。 */
interface FieldErrors {
  current?: string;
  next?: string;
  confirm?: string;
}

/** 改密成功后后端已撤销该管理员的全部会话，必须回登录页重新登录。 */
const SUCCESS_NOTICE = '密码已修改，请使用新口令重新登录';

/**
 * 账号安全：管理员自助改密。
 *
 * 前端校验顺序与后端一致（当前口令 → 强度 → 与旧口令不同），
 * 强度文案直接复用与后端同源的 password-policy，避免两套措辞。
 */
export function AccountSettings() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clearError = (field: keyof FieldErrors) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    setFormError(null);
  };

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!current) {
      e.current = '请输入当前口令';
    }
    if (!next) {
      e.next = '请输入新口令';
    } else {
      // 判定顺序与后端一致：先强度，后「与当前口令相同」
      const failed = PASSWORD_RULES.find((rule) => !rule.test(next));
      if (failed) e.next = failed.reason(next);
      else if (next === current) e.next = '新口令不能与当前口令相同';
    }
    if (!confirm) {
      e.confirm = '请再次输入新口令';
    } else if (confirm !== next) {
      e.confirm = '两次输入的新口令不一致';
    }
    return e;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const res = await changePassword(current, next);
    if (res.ok) {
      // 后端已撤销全部会话：清掉本地会话 → 留一条明确提示 → 回登录页（不沿用旧 token）
      logout();
      setAuthNotice(SUCCESS_NOTICE);
      navigate('/login', { replace: true });
      return;
    }
    setSubmitting(false);
    if (res.kind === 'current-password') {
      setErrors({ current: res.message });
    } else if (res.kind === 'weak-password') {
      setErrors({ next: res.message });
    } else {
      setErrors({});
      setFormError(res.message);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-start gap-2.5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary-subtle-foreground">
            <KeyRound className="size-4" strokeWidth={2} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-medium text-foreground">修改登录口令</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              新口令至少 8 位，且同时包含字母与数字。提交成功后当前账号的所有登录会话会被强制下线，需要用新口令重新登录。
            </p>
          </div>
        </div>

        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField
            id="account-current-password"
            label="当前口令"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            error={errors.current}
            onChange={(e) => {
              setCurrent(e.target.value);
              clearError('current');
            }}
          />

          <div>
            <TextField
              id="account-new-password"
              label="新口令"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              error={errors.next}
              onChange={(e) => {
                setNext(e.target.value);
                clearError('next');
              }}
            />
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {PASSWORD_RULES.map((rule) => {
                const satisfied = rule.test(next);
                return (
                  <li
                    key={rule.id}
                    className={cn(
                      'flex items-center gap-1 text-xs',
                      satisfied ? 'text-success' : 'text-muted-foreground',
                    )}
                  >
                    {satisfied ? (
                      <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                    ) : (
                      <Circle className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    )}
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <TextField
            id="account-confirm-password"
            label="确认新口令"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            error={errors.confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              clearError('confirm');
            }}
          />

          {formError && (
            <p
              className="rounded-md border border-destructive bg-destructive-subtle px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {formError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button type="submit" loading={submitting}>
              {submitting ? '提交中…' : '修改口令'}
            </Button>
            <span className="text-xs text-muted-foreground">提交后当前会话会立即失效</span>
          </div>
        </form>
      </div>
    </div>
  );
}
