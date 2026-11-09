'use client';

import { useState } from 'react';
import { Button, cn } from '@mall/ui';
import { TextField } from '@/components/form-field';
import { login, register, type CustomerProfile } from '@/lib/account';

type Tab = 'login' | 'register';

/** 登录 / 注册表单（邮箱 + 密码；手机号仅软标识，不做验证码）。 */
export function AuthForm({ onAuthed }: { onAuthed: (profile: CustomerProfile) => void }) {
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchTab = (t: Tab) => {
    setTab(t);
    setErrors({});
    setFormError(null);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = '请输入有效邮箱';
    if (password.length < 6) e.password = '密码至少 6 位';
    if (tab === 'register' && phone.trim() && !/^1[3-9]\d{9}$/.test(phone.trim())) e.phone = '手机号格式不正确';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    const res = tab === 'login' ? login(email, password) : register({ email, password, phone: phone.trim() || undefined });
    if (res.ok) onAuthed(res.profile);
    else setFormError(res.error);
    setSubmitting(false);
  };

  return (
    <div className="mx-auto max-w-md">
      <div role="tablist" aria-label="登录或注册" className="mb-6 flex border-b border-border">
        <TabButton active={tab === 'login'} onClick={() => switchTab('login')}>
          登录
        </TabButton>
        <TabButton active={tab === 'register'} onClick={() => switchTab('register')}>
          注册
        </TabButton>
      </div>

      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField
          id="email"
          label="邮箱"
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <TextField
          id="password"
          label="密码"
          required
          type="password"
          autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={tab === 'register' ? '至少 6 位' : undefined}
        />
        {tab === 'register' && (
          <TextField
            id="phone"
            label="手机号"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
            hint="选填，仅作软标识，不做短信验证"
          />
        )}
        {formError && (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {tab === 'login' ? '登录' : '注册并登录'}
        </Button>
      </form>

      {tab === 'login' && (
        <p className="mt-4 text-center text-xs text-muted-foreground">演示账号：demo@example.com / demo1234</p>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm transition-colors duration-150',
        active ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
