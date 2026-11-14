import { notFound } from 'next/navigation';
import { getStoreClient } from '@/lib/api';

/**
 * 微页面（ADR-082 / ADR-091）。
 *
 * 只渲染已发布；草稿与不存在的 slug 一样 404。
 * 富文本（content_format=html）由服务端过白名单清洗后才下发，
 * 这里用 dangerouslySetInnerHTML 是安全的 —— 内容里不可能有 script / 事件 / javascript:。
 * 纯文本（plain）仍按空行分段，老数据不受影响。
 */
export default async function MicroPage({
  params,
}: {
  params: Promise<{ locale: string; channel: string; slug: string }>;
}) {
  const { slug } = await params;
  let page: { title?: string; content?: string; content_format?: string } | null = null;
  try {
    page = (await getStoreClient().getStorePage(slug)) as {
      title?: string;
      content?: string;
      content_format?: string;
    };
  } catch {
    page = null;
  }
  if (!page?.title) notFound();

  const isHtml = page.content_format === 'html';

  return (
    <article className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl text-foreground">{page.title}</h1>
      {isHtml ? (
        <div
          className="rich-text mt-6"
          dangerouslySetInnerHTML={{ __html: page.content ?? '' }}
        />
      ) : (
        <div className="mt-6 space-y-4">
          {(page.content ?? '')
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="text-base leading-7 text-muted-foreground">
                {p}
              </p>
            ))}
        </div>
      )}
    </article>
  );
}
