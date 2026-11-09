'use client';

import { useEffect, useState } from 'react';
import { LogOut, User } from 'lucide-react';
import { Button, Skeleton } from '@mall/ui';
import { AuthForm } from './auth-form';
import { AddressBook } from './address-book';
import { getSession, logout, type CustomerProfile } from '@/lib/account';

/** 账户页：未登录=登录/注册；已登录=基本信息 + 地址簿。 */
export function AccountView() {
  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);

  useEffect(() => {
    setProfile(getSession());
    setMounted(true);
  }, []);

  return (
    <div className="mx-auto max-w-narrow px-4 py-6 md:py-8">
      <h1 className="mb-6 text-xl md:text-2xl">账户</h1>

      {!mounted ? (
        <Skeleton className="h-48 w-full" />
      ) : profile ? (
        <div className="space-y-8">
          <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="profile-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
                  <User className="size-5" strokeWidth={2} aria-hidden="true" />
                </span>
                <div>
                  <h2 id="profile-heading" className="text-base font-semibold">
                    {profile.firstName ?? '我的账户'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {profile.email}
                    {profile.phone ? ` · ${profile.phone}` : ''}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  logout();
                  setProfile(null);
                }}
              >
                <LogOut className="size-4" strokeWidth={2} aria-hidden="true" />
                退出登录
              </Button>
            </div>
          </section>

          <AddressBook />
        </div>
      ) : (
        <AuthForm onAuthed={setProfile} />
      )}
    </div>
  );
}
