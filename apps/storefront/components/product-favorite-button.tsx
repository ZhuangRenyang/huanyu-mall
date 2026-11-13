'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { Button } from '@mall/ui';
import { getAccessToken } from '@/lib/account';
import { addFavorite, isFavorite, removeFavorite } from '@/lib/favorites';

export interface ProductFavoriteButtonProps {
  productId: string;
  /** 未登录时跳这里（账户页登录后会回到来源页）。 */
  accountHref: string;
}

/**
 * 收藏按钮（ADR-048）。
 *
 * 未登录点收藏 → 去登录，不做「先记本地、登录后补收藏」：
 * 那种半接状态最容易出现「收藏了却没进收藏夹」。
 */
export function ProductFavoriteButton({ productId, accountHref }: ProductFavoriteButtonProps) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isFavorite(productId).then((v) => {
      if (cancelled) return;
      setFavorited(v);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const toggle = async () => {
    if (!getAccessToken()) {
      router.push(accountHref);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (favorited) await removeFavorite(productId);
      else await addFavorite(productId);
      setFavorited(!favorited);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => void toggle()}
        disabled={busy || !ready}
        aria-pressed={favorited}
      >
        <Star
          className={favorited ? 'size-5 fill-accent-orange text-accent-orange' : 'size-5'}
          strokeWidth={2}
          aria-hidden="true"
        />
        {favorited ? '已收藏' : '收藏'}
      </Button>
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
