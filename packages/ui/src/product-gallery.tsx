'use client';

import { useCallback, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from './lib/cn';
import type { GalleryImage } from './types';

export interface ProductGalleryProps {
  images: GalleryImage[];
  /** 主图比例，默认 4 / 5（CSS 比值写法）。 */
  aspectRatio?: string;
  /** 首图预加载（首页/PDP 首屏 LCP 图）。 */
  priority?: boolean;
}

/** 商品画廊：主图 + 缩略图条。键盘 ←/→ 切图，缩略图 aria-current。 */
export function ProductGallery({ images, aspectRatio = '4 / 5', priority = false }: ProductGalleryProps) {
  const [selected, setSelected] = useState(0);
  const count = images.length;
  const current = count > 0 ? images[Math.min(selected, count - 1)] : undefined;

  const step = useCallback(
    (dir: 1 | -1) => {
      if (count === 0) return;
      setSelected((i) => (i + dir + count) % count);
    },
    [count],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    }
  };

  if (count === 0) {
    return (
      <div
        className="grid w-full place-items-center rounded-lg bg-secondary"
        style={{ aspectRatio }}
        role="img"
        aria-label="图片加载失败"
      >
        <ImageOff className="size-6 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="relative w-full overflow-hidden rounded-lg bg-secondary"
        style={{ aspectRatio }}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="region"
        aria-label="商品图片，可用左右方向键切换"
      >
        {current && (
          <img
            src={current.url}
            alt={current.alt ?? ''}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {count > 1 && (
          <span className="tabular absolute bottom-2 right-2 rounded-full bg-neutral-900/60 px-2 py-0.5 text-xs text-neutral-0">
            {selected + 1} / {count}
          </span>
        )}
      </div>

      {count > 1 && (
        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="商品缩略图">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              role="tab"
              aria-selected={selected === i}
              aria-current={selected === i ? 'true' : undefined}
              aria-label={`查看第 ${i + 1} 张图片`}
              onClick={() => setSelected(i)}
              className={cn(
                'relative aspect-square w-16 shrink-0 overflow-hidden rounded-sm border-2 transition-colors duration-150',
                selected === i ? 'border-primary' : 'border-transparent hover:border-border-strong',
              )}
            >
              <img src={img.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
