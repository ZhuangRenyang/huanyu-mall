import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button, IconButton } from '@mall/ui';
import { TextField } from '@/components/field';
import { login } from '@/lib/admin-api';
import { clearAuthNotice, readAuthNotice } from '@/lib/admin-notice';
import { getAdminPassword } from '@/lib/admin-store';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // mock 模式改过口令后，初始口令提示就不再成立，别再误导用户
  const isSeedPassword = getAdminPassword() === '123456';

  // 改密成功等跨页面提示：读一次即清，避免下次登录还挂着旧提示。
  // 读取与清除分开做，StrictMode 下 effect 跑两遍也不会把提示抹掉。
  useEffect(() => {
    const msg = readAuthNotice();
    if (msg) setNotice(msg);
    clearAuthNotice();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('请输入账号');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    setSubmitting(true);
    const res = await login(email, password);
    if (res.ok) {
      navigate('/products', { replace: true });
    } else {
      setError(res.error);
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4" data-surface="admin">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">商</span>
          <span className="text-lg font-semibold text-foreground">商城管理后台</span>
        </div>

        <form onSubmit={submit} noValidate className="rounded-xl border border-border bg-card p-6 shadow-lg">
          <h1 className="mb-5 text-lg font-semibold text-foreground">登录管理后台</h1>
          {notice && (
            <p
              className="mb-4 rounded-md border border-success bg-success-subtle px-3 py-2 text-sm text-success"
              role="status"
            >
              {notice}
            </p>
          )}
          <div className="space-y-4">
            <TextField
              id="login-email"
              label="账号"
              type="email"
              autoComplete="username"
              placeholder="admin"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div>
              <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-foreground">
                密码
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm text-foreground outline-none transition-colors duration-150 focus:border-ring"
                />
                <span className="absolute right-1 top-1/2 -translate-y-1/2">
                  <IconButton
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPwd}
                    size="sm"
                    onClick={() => setShowPwd((s) => !s)}
                  >
                    {showPwd ? <EyeOff className="size-5" strokeWidth={2} aria-hidden="true" /> : <Eye className="size-5" strokeWidth={2} aria-hidden="true" />}
                  </IconButton>
                </span>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" size="lg" className="mt-5 w-full" loading={submitting}>
            {submitting ? '登录中…' : '登录'}
          </Button>
        </form>

        {isSeedPassword && (
          <p className="mt-4 text-center text-xs text-muted-foreground">默认账号：admin / 123456</p>
        )}
      </div>
    </div>
  );
}
