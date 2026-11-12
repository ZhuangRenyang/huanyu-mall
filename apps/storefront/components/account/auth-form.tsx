'use client';

import { useEffect, useState } from 'react';
import { Button, cn } from '@mall/ui';
import { TextField } from '@/components/form-field';
import {
  ACCOUNT_LIVE,
  fetchAuthSettings,
  login,
  loginWithPhoneCode,
  register,
  sendCode,
  type CustomerProfile,
  type RegisterMode,
} from '@/lib/account';
import { syncStoreToken } from '@/lib/api';

/**
 * 登录 / 注册（对齐淘宝与 Shopify 两种成熟做法，ADR-025）。
 *
 * 注册方式由商家在后台「设置 → 顾客账号」决定，店面不写死：
 *   - 邮箱注册（Shopify 路线）：邮箱 + 密码 + 手机号（必填）+ 验证码；
 *     验证码可发邮箱也可发手机，顾客自己选。
 *   - 手机号注册（淘宝路线）：手机号 + 验证码，注册即登录 ——
 *     第一次输码就是注册，之后每次输码就是登录，不让顾客先选「新老用户」。
 *
 * 登录始终两条入口（密码 / 验证码），不跟注册方式绑定：
 * 邮箱注册出来的账号也能用手机号 + 验证码进。
 */
type Tab = 'login' | 'register';
type LoginMode = 'password' | 'code';
/** 邮箱注册时验证码发到哪。 */
type VerifyChannel = 'email' | 'sms';

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthForm({ onAuthed }: { onAuthed: (profile: CustomerProfile) => void }) {
  /** null = 还没读到后台设置，按邮箱注册先渲染（独立站默认）。 */
  const [registerMode, setRegisterMode] = useState<RegisterMode | null>(null);
  const [tab, setTab] = useState<Tab>('login');
  const [loginMode, setLoginMode] = useState<LoginMode>('password');
  const [verifyChannel, setVerifyChannel] = useState<VerifyChannel>('email');

  /** 密码登录用：邮箱或手机号都填这里（淘宝一个输入框）。 */
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthSettings().then((s) => {
      if (!cancelled) setRegisterMode(s.registerMode);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 验证码倒计时：60 秒内不让重复点，和淘宝一致
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const mode: RegisterMode = registerMode ?? 'email';
  /** 手机号注册 = 注册即登录，没有独立的「注册」页签。 */
  const allowEmailRegister = mode === 'email';

  const switchTab = (next: Tab) => {
    setTab(next);
    setErrors({});
    setFormError(null);
  };

  const resetMessages = () => {
    setErrors({});
    setFormError(null);
    setDevCode(null);
  };

  /** 当前这次「发验证码」是发给谁 —— 注册发到选中通道，登录只发短信。 */
  const codeTarget = (): { channel: VerifyChannel; target: string } => {
    if (tab === 'register') {
      return verifyChannel === 'email'
        ? { channel: 'email', target: email.trim() }
        : { channel: 'sms', target: phone.trim() };
    }
    return { channel: 'sms', target: phone.trim() };
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (tab === 'login' && loginMode === 'password') {
      if (!identifier.trim()) e.identifier = '请输入邮箱或手机号';
      if (password.length < 6) e.password = '密码至少 6 位';
    }
    if (tab === 'login' && loginMode === 'code') {
      if (!PHONE_RE.test(phone.trim())) e.phone = '请输入有效手机号';
      if (!/^\d{6}$/.test(code.trim())) e.code = '请输入 6 位验证码';
    }
    if (tab === 'register') {
      if (!EMAIL_RE.test(email.trim())) e.email = '请输入有效邮箱';
      if (password.length < 8) e.password = '密码至少 8 位';
      // 注册必须填手机号：它是这个账号的第二个登录入口
      if (!PHONE_RE.test(phone.trim())) e.phone = '请输入有效手机号';
      if (!/^\d{6}$/.test(code.trim())) e.code = '请输入 6 位验证码';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const send = async () => {
    const { channel, target } = codeTarget();
    const valid = channel === 'email' ? EMAIL_RE.test(target) : PHONE_RE.test(target);
    if (!valid) {
      setErrors((prev) => ({
        ...prev,
        [channel === 'email' ? 'email' : 'phone']:
          channel === 'email' ? '请先填写有效邮箱' : '请先填写有效手机号',
      }));
      return;
    }
    setSending(true);
    setFormError(null);
    try {
      const res = await sendCode({
        channel,
        target,
        purpose: tab === 'register' ? 'register' : 'login',
      });
      setCountdown(60);
      // 开发环境后端会回传验证码：直接显示，免得去翻服务器日志
      setDevCode(res.devCode ?? null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '发送失败，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res =
        tab === 'register'
          ? await register({ email, password, phone, channel: verifyChannel, code })
          : loginMode === 'code'
            ? await loginWithPhoneCode(phone, code)
            : await login(identifier, password);

      if (res.ok) {
        // 同步 SDK 里的 token：否则登录成功但后续下单/查单仍是无身份请求
        syncStoreToken();
        onAuthed(res.profile);
      } else {
        setFormError(res.error);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const codeField = (
    <>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            id="code"
            label="验证码"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={errors.code}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mb-0.5 shrink-0"
          disabled={sending || countdown > 0}
          onClick={() => void send()}
        >
          {countdown > 0 ? `${countdown}s 后重发` : sending ? '发送中…' : '获取验证码'}
        </Button>
      </div>
      {devCode && (
        <p className="text-xs text-muted-foreground" role="status">
          开发环境验证码：
          <span className="tabular font-medium text-foreground">{devCode}</span>
        </p>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-md">
      <div role="tablist" aria-label="登录或注册" className="mb-4 flex border-b border-border">
        <TabButton active={tab === 'login'} onClick={() => switchTab('login')}>
          登录
        </TabButton>
        {allowEmailRegister && (
          <TabButton active={tab === 'register'} onClick={() => switchTab('register')}>
            注册
          </TabButton>
        )}
      </div>

      {/* 二级切换：登录方式 / 验证码通道 */}
      <div
        className="mb-5 flex gap-1"
        role="tablist"
        aria-label={tab === 'login' ? '登录方式' : '验证码接收方式'}
      >
        {(tab === 'login'
          ? [
              { value: 'password', label: '密码登录' },
              { value: 'code', label: '验证码登录' },
            ]
          : [
              { value: 'email', label: '用邮箱验证' },
              { value: 'sms', label: '用手机验证' },
            ]
        ).map((m) => {
          const active =
            tab === 'login' ? loginMode === m.value : verifyChannel === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (tab === 'login') setLoginMode(m.value as LoginMode);
                else setVerifyChannel(m.value as VerifyChannel);
                resetMessages();
              }}
              className={cn(
                'h-8 rounded-md px-3 text-sm transition-colors duration-150',
                active
                  ? 'bg-primary-subtle font-medium text-primary-subtle-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <form onSubmit={submit} noValidate className="space-y-4">
        {/* 密码登录：一个输入框同时收邮箱与手机号 */}
        {tab === 'login' && loginMode === 'password' && (
          <>
            <TextField
              id="identifier"
              label="邮箱或手机号"
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              error={errors.identifier}
            />
            <TextField
              id="password"
              label="密码"
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
            />
          </>
        )}

        {/* 验证码登录（手机号） */}
        {tab === 'login' && loginMode === 'code' && (
          <>
            <TextField
              id="phone"
              label="手机号"
              required
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={errors.phone}
            />
            {codeField}
            {mode === 'phone' && (
              <p className="text-xs text-muted-foreground">
                未注册的手机号验证后会直接创建账号并登录。
              </p>
            )}
          </>
        )}

        {/* 邮箱注册：邮箱 + 密码 + 手机号（必填）+ 验证码 */}
        {tab === 'register' && (
          <>
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              hint="至少 8 位"
            />
            <TextField
              id="phone"
              label="手机号"
              required
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={errors.phone}
              hint={
                verifyChannel === 'sms'
                  ? '验证码会发到这个号码'
                  : '必填：注册后也能用手机号 + 验证码登录'
              }
            />
            {codeField}
          </>
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

      {tab === 'register' && (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          注册后可以用邮箱或手机号 + 密码登录，也可以用手机号 + 验证码登录。
        </p>
      )}

      {!ACCOUNT_LIVE && tab === 'login' && loginMode === 'password' && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          演示账号：demo@example.com / demo1234
        </p>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm transition-colors duration-150',
        active
          ? 'border-primary font-medium text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
