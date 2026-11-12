'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  cn,
} from '@mall/ui';
import { submitReview } from '@/lib/reviews';

export interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  productId: string;
  productTitle: string;
  /** 提交成功后回调（父组件把该商品标为「已评价」）。 */
  onDone: () => void;
}

const RATING_HINT: Record<number, string> = {
  1: '很差',
  2: '较差',
  3: '一般',
  4: '满意',
  5: '非常满意',
};

/**
 * 评价弹窗（ADR-042）。
 *
 * 只收两样东西：星级 + 一段文字（可以不写 = 默认好评）。
 * 不做图片/视频：那要文件上传与审核，先把「有没有评价」这件事补上。
 */
export function ReviewDialog({
  open,
  onOpenChange,
  orderId,
  productId,
  productTitle,
  onDone,
}: ReviewDialogProps) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await submitReview({ orderId, productId, productTitle, rating, content });
      onDone();
      onOpenChange(false);
      setContent('');
      setRating(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>评价商品</DialogTitle>
          <DialogDescription className="line-clamp-2">{productTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm text-foreground">评分</p>
            <div className="flex items-center gap-1" role="radiogroup" aria-label="评分">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  role="radio"
                  aria-checked={rating === star}
                  aria-label={`${star} 星`}
                  onClick={() => setRating(star)}
                  className="rounded p-0.5 transition-transform duration-150 hover:scale-110"
                >
                  <Star
                    className={cn(
                      'size-6',
                      star <= rating ? 'fill-accent-orange text-accent-orange' : 'text-border-strong',
                    )}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                </button>
              ))}
              <span className="ml-2 text-sm text-muted-foreground">{RATING_HINT[rating]}</span>
            </div>
          </div>

          <div>
            <label htmlFor="review-content" className="mb-1.5 block text-sm text-foreground">
              评价内容（选填）
            </label>
            <Textarea
              id="review-content"
              value={content}
              maxLength={500}
              rows={4}
              placeholder="说说使用感受，给后来的顾客一个参考"
              onChange={(e) => setContent(e.target.value)}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{content.length} / 500</p>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            评价会公开显示，昵称做脱敏处理（如「张**」）。提交后不能修改。
          </p>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? '提交中…' : '提交评价'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
