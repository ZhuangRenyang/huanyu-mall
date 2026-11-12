import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { MockCategory } from '@/lib/mock-products';

/**
 * 首页分类入口（ADR-032）。
 *
 * 淘宝首页第二块就是分类（金刚区）：顾客不搜的时候靠它逛。
 * 改造前首页直接铺商品，顾客除了「最新上架」没有别的入口 ——
 * 分类建了等于没建。
 *
 * 只列一级分类：二级在列表页的筛选栏里出现（点进一级就能看到），
 * 首页塞两层会让宫格变成一堵墙。
 */
export function CategoryGrid({ categories, basePath }: { categories: MockCategory[]; basePath: string }) {
  const roots = categories.filter((c) => !c.parentId);
  if (roots.length === 0) return null;

  return (
    <section aria-labelledby="categories-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="categories-heading" className="text-lg md:text-xl">
          全部分类
        </h2>
        <Link
          href={`${basePath}/products`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          全部商品
          <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 md:gap-3">
        {roots.map((c) => (
          <li key={c.id}>
            <Link
              href={`${basePath}/products?category=${encodeURIComponent(c.id)}`}
              className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card px-2 py-4 text-center transition-colors duration-150 hover:bg-muted"
            >
              <span className="text-sm font-medium text-foreground">{c.name}</span>
              {typeof c.productCount === 'number' && (
                <span className="tabular text-xs text-muted-foreground">{c.productCount} 件</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
