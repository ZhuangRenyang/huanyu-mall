import { getApiMode, getStoreClient } from './api';
import { getAccessToken } from './account';

/**
 * 商品评价（店面，ADR-042）。
 *
 * 读匿名可用；写必须登录。mock 模式给两条静态评价，另有本地追加
 * （存 sessionStorage），让演示也能走完「评价 → 详情页看到」的闭环。
 */

export interface ReviewView {
  id: string;
  customerName: string;
  rating: number;
  content: string;
  /** 商家解释。 */
  reply: string | null;
  createdAt: number;
}

export interface ReviewSummaryView {
  /** 无评价为 null（显示「暂无评价」，不是 0.0 分）。 */
  average: number | null;
  count: number;
  distribution: Record<string, number>;
}

export interface ProductReviewsView {
  items: ReviewView[];
  summary: ReviewSummaryView;
}

const MOCK_KEY = 'reviews:mine';

/** 演示用评价：只给 mock 目录里的两件商品，其余显示「暂无评价」（这是诚实的）。 */
const MOCK_REVIEWS: Record<string, ReviewView[]> = {
  'wireless-mouse': [
    {
      id: 'rev_mock_1',
      customerName: '李**',
      rating: 5,
      content: '静音效果确实好，晚上加班点鼠标不吵同事。电池也耐用。',
      reply: null,
      createdAt: Date.now() - 3 * 86400_000,
    },
    {
      id: 'rev_mock_2',
      customerName: '王**',
      rating: 4,
      content: '手感不错，就是稍微有点轻，习惯重一点的可以看看别的。',
      reply: '感谢反馈，配重块可以在配件包里加装。',
      createdAt: Date.now() - 9 * 86400_000,
    },
  ],
  'mechanical-keyboard': [
    {
      id: 'rev_mock_3',
      customerName: 't***',
      rating: 5,
      content: '红轴很顺，热插拔换了套键帽，办公室用刚好。',
      reply: null,
      createdAt: Date.now() - 5 * 86400_000,
    },
  ],
};

interface ApiReview {
  id: string;
  customer_name: string;
  rating: number;
  content: string;
  reply: string | null;
  created_at: string;
}

function readMine(): Record<string, ReviewView[]> {
  try {
    const raw = sessionStorage.getItem(MOCK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ReviewView[]>) : {};
  } catch {
    return {};
  }
}

function writeMine(next: Record<string, ReviewView[]>): void {
  try {
    sessionStorage.setItem(MOCK_KEY, JSON.stringify(next));
  } catch {
    /* 存不下不影响展示（下次刷新就没了） */
  }
}

function summarize(items: ReviewView[]): ReviewSummaryView {
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let sum = 0;
  for (const r of items) {
    distribution[String(r.rating)] = (distribution[String(r.rating)] ?? 0) + 1;
    sum += r.rating;
  }
  return {
    average: items.length > 0 ? Math.round((sum / items.length) * 10) / 10 : null,
    count: items.length,
    distribution,
  };
}

/**
 * 商品详情页的评价区。
 *
 * mock 模式下本地追加的评价按「商品标题」存：详情页只有 handle，
 * 而订单里只有标题（没有 handle），两边唯一的共同标识是标题。
 */
export async function getProductReviews(handle: string, title?: string): Promise<ProductReviewsView> {
  if (getApiMode() !== 'live') {
    const mine = readMine()[title ?? handle] ?? [];
    const items = [...mine, ...(MOCK_REVIEWS[handle] ?? [])];
    return { items, summary: summarize(items) };
  }
  try {
    const res = (await getStoreClient().listProductReviews(handle, { limit: 10 })) as {
      items?: ApiReview[];
      summary?: { average: number | null; count: number; distribution?: Record<string, number> };
    };
    const items = (res.items ?? []).map((r) => ({
      id: r.id,
      customerName: r.customer_name,
      rating: r.rating,
      content: r.content,
      reply: r.reply,
      createdAt: Date.parse(r.created_at),
    }));
    return {
      items,
      summary: {
        average: res.summary?.average ?? null,
        count: res.summary?.count ?? items.length,
        distribution: res.summary?.distribution ?? summarize(items).distribution,
      },
    };
  } catch {
    // 评价拉不到不该让商品页挂掉：返回空，页面显示「暂无评价」
    return { items: [], summary: { average: null, count: 0, distribution: {} } };
  }
}

/** 提交评价（需登录；一单一商品一条）。 */
export async function submitReview(input: {
  orderId: string;
  productId: string;
  productTitle: string;
  handle?: string;
  rating: number;
  content: string;
}): Promise<void> {
  if (getApiMode() !== 'live') {
    const key = input.productTitle;
    const mine = readMine();
    mine[key] = [
      {
        id: `rev_${Date.now().toString(36)}`,
        customerName: '我**',
        rating: input.rating,
        content: input.content,
        reply: null,
        createdAt: Date.now(),
      },
      ...(mine[key] ?? []),
    ];
    writeMine(mine);
    return;
  }
  if (!getAccessToken()) throw new Error('请先登录后再评价');
  await getStoreClient().createReview({
    order_id: input.orderId,
    product_id: input.productId,
    rating: input.rating,
    ...(input.content.trim() ? { content: input.content.trim() } : {}),
  });
}
