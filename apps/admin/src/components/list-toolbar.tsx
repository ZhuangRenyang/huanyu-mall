import { Search } from 'lucide-react';
import { Button } from '@mall/ui';

/**
 * 列表页的搜索框与分页条（营销三张列表共用）。
 *
 * 抽出来不是为了「复用几行 JSX」，而是让三张列表的分页行为一致：
 * 换关键字回第一页、总数用服务端口径、按钮在加载中禁用。
 */
export function ListSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative block w-full max-w-xs">
      <span className="sr-only">{placeholder}</span>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={2}
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-ring"
      />
    </label>
  );
}

export function ListPager({
  page,
  hasMore,
  total,
  loading,
  onPrev,
  onNext,
}: {
  /** 从 0 开始。 */
  page: number;
  hasMore: boolean;
  total: number;
  loading?: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">共 {total} 条</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0 || loading} onClick={onPrev}>
          上一页
        </Button>
        <span className="text-xs text-muted-foreground">第 {page + 1} 页</span>
        <Button size="sm" variant="secondary" disabled={!hasMore || loading} onClick={onNext}>
          下一页
        </Button>
      </div>
    </div>
  );
}
