import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Star } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
  Textarea,
  cn,
} from '@mall/ui';
import {
  listReviews,
  replyReview,
  setReviewVisible,
  type AdminReviewView,
  type ReviewListResult,
  type ReviewVisibilityFilter,
} from '@/lib/admin-api';

const FILTERS: Array<{ key: ReviewVisibilityFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'visible', label: '展示中' },
  { key: 'hidden', label: '已隐藏' },
];

const PAGE_SIZE = 20;

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} 星`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn('size-3.5', i <= rating ? 'fill-accent-orange text-accent-orange' : 'text-border-strong')}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/**
 * 评价管理（淘宝「交易 → 评价管理」，ADR-042）。
 *
 * 商家在这里只看得到「哪些需要处理」：差评要不要解释、辱骂广告要不要隐藏。
 * 评分本身不可改 —— 能改评分的话，评分就不代表顾客的真实感受了。
 */
export function ReviewsPage() {
  const [result, setResult] = useState<ReviewListResult>({ items: [], total: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewVisibilityFilter>('all');
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<AdminReviewView | null>(null);
  const [replyText, setReplyText] = useState('');
  const [savingReply, setSavingReply] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listReviews({
        visibility: filter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setResult(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取评价失败');
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleVisible = async (review: AdminReviewView) => {
    setBusyId(review.id);
    try {
      await setReviewVisible(review.id, !review.visible);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const openReply = (review: AdminReviewView) => {
    setReplyFor(review);
    setReplyText(review.reply ?? '');
  };

  const saveReply = async () => {
    if (!replyFor) return;
    setSavingReply(true);
    try {
      await replyReview(replyFor.id, replyText);
      setReplyFor(null);
      await load();
    } finally {
      setSavingReply(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">评价管理</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          顾客确认收货后可以评价。隐藏只影响店面展示，评分与内容都不会被修改。
        </p>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="评价状态">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              setPage(0);
            }}
            className={
              filter === f.key
                ? 'h-8 rounded-md bg-primary-subtle px-3 text-sm font-medium text-primary-subtle-foreground'
                : 'h-8 rounded-md px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted'
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : result.items.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="没有评价"
          description={filter === 'all' ? '顾客确认收货后提交的评价会出现在这里' : '换个页签看看'}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">商品</th>
                <th className="px-4 py-3 font-medium">评分</th>
                <th className="px-4 py-3 font-medium">评价内容</th>
                <th className="px-4 py-3 font-medium">顾客</th>
                <th className="px-4 py-3 font-medium">时间</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.items.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <span className="line-clamp-2-safe text-foreground">{r.productTitle}</span>
                    <span className="mt-0.5 block tabular font-mono text-xs text-muted-foreground">
                      {r.orderId}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Stars rating={r.rating} />
                  </td>
                  <td className="max-w-[320px] px-4 py-3">
                    <p className="text-foreground">{r.content.trim() || '（未填写内容）'}</p>
                    {r.reply && (
                      <p className="mt-1 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                        商家回复：{r.reply}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.customerName}</td>
                  <td className="px-4 py-3 tabular text-xs text-muted-foreground">
                    {formatDay(r.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {!r.visible && <Badge variant="neutral">已隐藏</Badge>}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === r.id}
                        onClick={() => void toggleVisible(r)}
                      >
                        {r.visible ? '隐藏' : '显示'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => openReply(r)}>
                        解释
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">共 {result.total} 条</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">第 {page + 1} 页</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!result.hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      <Dialog open={replyFor !== null} onOpenChange={(open) => !open && setReplyFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>回复评价</DialogTitle>
            <DialogDescription className="line-clamp-2">
              {replyFor?.productTitle}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {replyFor?.content.trim() || '（顾客未填写内容）'}
            </p>
            <Textarea
              value={replyText}
              maxLength={300}
              rows={4}
              placeholder="解释会显示在评价下方，顾客与后来的买家都能看到"
              onChange={(e) => setReplyText(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">{replyText.length} / 300</p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReplyFor(null)} disabled={savingReply}>
              取消
            </Button>
            <Button onClick={() => void saveReply()} disabled={savingReply}>
              {savingReply ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
