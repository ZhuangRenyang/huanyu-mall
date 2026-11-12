import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Star } from 'lucide-react';
import { Button, IconButton, cn } from '@mall/ui';
import type { ProductImageDraft } from '@/lib/admin-data';

/**
 * 商品图集上传（对齐淘宝发布页的「商品图片」）。
 *
 * 规则：
 * - **第一张是主图**，列表页/购物车/订单都用它，界面上明确标出来；
 * - 最多 12 张（后端同限制），超了直接拦，不让用户白传；
 * - 顺序即提交顺序，服务端整组替换 —— 不用做增量 diff，也不会残留旧图。
 *
 * 上传失败时保留已有图片，只提示失败的这张，不让整组回滚。
 */
const MAX_IMAGES = 12;

export function ImageUploader({
  images,
  onChange,
  disabled,
}: {
  images: ProductImageDraft[];
  onChange: (next: ProductImageDraft[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => {
    setError(null);
    inputRef.current?.click();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setError(`最多 ${MAX_IMAGES} 张图片`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    setBusy(true);
    try {
      // 动态导入：上传逻辑只在真正选图时才需要
      const { uploadProductImage } = await import('@/lib/admin-catalog');
      const uploaded: ProductImageDraft[] = [];
      for (const file of picked) {
        uploaded.push(await uploadProductImage(file));
      }
      onChange([...images, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
    setError(null);
  };

  const makePrimary = (index: number) => {
    if (index === 0) return;
    const next = [...images];
    const [picked] = next.splice(index, 1);
    onChange([picked!, ...next]);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((image, index) => (
          <div
            key={image.fileId}
            className={cn(
              'group relative size-24 overflow-hidden rounded-md border bg-muted',
              index === 0 ? 'border-primary' : 'border-border',
            )}
          >
            {image.url ? (
              <img src={image.url} alt={`商品图 ${index + 1}`} className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-[11px] text-muted-foreground">
                无预览
              </div>
            )}
            {index === 0 && (
              <span className="absolute left-1 top-1 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                主图
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-0.5 bg-background/80 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {index !== 0 && (
                <IconButton
                  size="sm"
                  aria-label={`把第 ${index + 1} 张设为主图`}
                  onClick={() => makePrimary(index)}
                  disabled={disabled}
                >
                  <Star className="size-3.5" strokeWidth={2} aria-hidden="true" />
                </IconButton>
              )}
              <IconButton
                size="sm"
                aria-label={`删除第 ${index + 1} 张图片`}
                onClick={() => remove(index)}
                disabled={disabled}
              >
                <Trash2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        ))}

        {images.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={pick}
            disabled={disabled || busy}
            className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
          >
            <ImagePlus className="size-5" strokeWidth={1.5} aria-hidden="true" />
            {busy ? '上传中…' : '添加图片'}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <p className="text-xs text-muted-foreground">
        第一张是主图，会显示在商品列表、购物车和订单里。最多 {MAX_IMAGES} 张，单张不超过 20MB。
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {images.length === 0 && !error && (
        <p className="text-xs text-warning">还没有图片。没有主图的商品在店面会显示成空白块。</p>
      )}
    </div>
  );
}

/** 主图缩略图（列表页用）。 */
export function ProductThumb({ url, title }: { url: string | null; title: string }) {
  if (!url) {
    return (
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] text-muted-foreground"
        aria-hidden="true"
      >
        无图
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="size-10 shrink-0 rounded border border-border object-cover"
      // 图片挂了不该让整行报错，退化成占位
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
      title={title}
    />
  );
}
