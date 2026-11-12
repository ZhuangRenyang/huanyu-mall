'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

/**
 * 首页搜索（ADR-032）。
 *
 * 位置照淘宝：首页第一屏就是搜索框。改造前首页只有商品网格，
 * 想搜东西得先进「全部商品」再找那个搜索框 —— 把最常用的动作藏了一层。
 *
 * 只负责把关键字写进 URL，真正取数在列表页（服务端按 q 查）。
 */
export function HomeSearch({ basePath }: { basePath: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const keyword = q.trim();
    router.push(keyword ? `${basePath}/products?q=${encodeURIComponent(keyword)}` : `${basePath}/products`);
  };

  return (
    <form onSubmit={submit} role="search" className="mx-auto w-full max-w-xl">
      <label className="relative block">
        <span className="sr-only">搜索商品</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
        <input
          type="search"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索商品名称"
          className="h-12 w-full rounded-full border border-input bg-background pl-10 pr-24 text-sm outline-none transition-colors duration-150 focus:border-ring"
        />
        <button
          type="submit"
          className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-full bg-primary px-5 text-sm text-primary-foreground transition-colors duration-150 hover:bg-primary-hover"
        >
          搜索
        </button>
      </label>
    </form>
  );
}
