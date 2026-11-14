import { notFound } from 'next/navigation';
import { getStoreClient } from '@/lib/api';

/** 微页面（ADR-082）：只渲染已发布；草稿与不存在的 slug 一样 404。 */
export default async function MicroPage({
  params,
}: {
  params: Promise<{ locale: string; channel: string; slug: string }>;
}) {
  const { slug } = await params;
  let page: { title?: string; content?: string } | null = null;
  try {
    page = (await getStoreClient().getStorePage(slug)) as { title?: string; content?: string };
  } catch {
    page = null;
  }
  if (!page?.title) notFound();

  const paragraphs = (page.content ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl text-foreground">{page.title}</h1>
      <div className="mt-6 space-y-4">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-base leading-7 text-muted-foreground">
            {p}
          </p>
        ))}
      </div>
    </article>
  );
}
