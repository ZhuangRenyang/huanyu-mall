import { adminClient, getAdminApiMode } from './admin-client';

/**
 * 评价管理（后台，ADR-042）。
 *
 * 只做两件事：隐藏（辱骂/广告/无关内容）与解释（差评给个说法）。
 * 不改评分、不代顾客写评价 —— 那会让评分失去意义。
 */

export interface AdminReviewView {
  id: string;
  productId: string;
  productTitle: string;
  orderId: string;
  customerName: string;
  rating: number;
  content: string;
  visible: boolean;
  reply: string | null;
  createdAt: string;
}

export interface ReviewListResult {
  items: AdminReviewView[];
  total: number;
  hasMore: boolean;
}

export type ReviewVisibilityFilter = 'all' | 'visible' | 'hidden';

interface ApiReview {
  id: string;
  product_id: string;
  product_title: string;
  order_id: string;
  customer_name: string;
  rating: number;
  content: string;
  is_visible: boolean;
  reply: string | null;
  created_at: string;
}

function mapReview(r: ApiReview): AdminReviewView {
  return {
    id: r.id,
    productId: r.product_id,
    productTitle: r.product_title,
    orderId: r.order_id,
    customerName: r.customer_name,
    rating: r.rating,
    content: r.content,
    visible: r.is_visible,
    reply: r.reply,
    createdAt: r.created_at,
  };
}

const MOCK_KEY = 'admin:reviews';

function seed(): AdminReviewView[] {
  const now = Date.now();
  return [
    {
      id: 'rev_seed_1',
      productId: 'prod_1',
      productTitle: '无线静音鼠标',
      orderId: 'ord_1001',
      customerName: '李**',
      rating: 5,
      content: '静音效果确实好，晚上加班点鼠标不吵同事。',
      visible: true,
      reply: null,
      createdAt: new Date(now - 2 * 86400_000).toISOString(),
    },
    {
      id: 'rev_seed_2',
      productId: 'prod_1',
      productTitle: '无线静音鼠标',
      orderId: 'ord_1002',
      customerName: '王**',
      rating: 3,
      content: '手感偏轻，其他还行。',
      visible: true,
      reply: '感谢反馈，配重块可在配件包里加装。',
      createdAt: new Date(now - 6 * 86400_000).toISOString(),
    },
    {
      id: 'rev_seed_3',
      productId: 'prod_2',
      productTitle: '87 键机械键盘',
      orderId: 'ord_1003',
      customerName: 't***',
      rating: 1,
      content: '发货太慢，客服也不回。',
      visible: false,
      reply: null,
      createdAt: new Date(now - 9 * 86400_000).toISOString(),
    },
  ];
}

function readMock(): AdminReviewView[] {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (!raw) {
      const list = seed();
      localStorage.setItem(MOCK_KEY, JSON.stringify(list));
      return list;
    }
    return JSON.parse(raw) as AdminReviewView[];
  } catch {
    return seed();
  }
}

function writeMock(list: AdminReviewView[]): void {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(list));
  } catch {
    /* noop */
  }
}

export async function listReviews(params: {
  visibility?: ReviewVisibilityFilter;
  limit?: number;
  offset?: number;
} = {}): Promise<ReviewListResult> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  if (getAdminApiMode() !== 'live') {
    let all = readMock();
    if (params.visibility === 'visible') all = all.filter((r) => r.visible);
    if (params.visibility === 'hidden') all = all.filter((r) => !r.visible);
    return {
      items: all.slice(offset, offset + limit),
      total: all.length,
      hasMore: offset + limit < all.length,
    };
  }

  const query: Record<string, string | number> = { limit, offset };
  // 后台接口按「只看展示中 / 只看已隐藏」筛；all 不传参数
  if (params.visibility === 'visible') query.visible = 'true';
  if (params.visibility === 'hidden') query.visible = 'false';
  const res = (await adminClient().listReviews(query)) as {
    items?: ApiReview[];
    count?: number;
    hasMore?: boolean;
  };
  return {
    items: (res.items ?? []).map(mapReview),
    total: res.count ?? 0,
    hasMore: res.hasMore === true,
  };
}

/** 显示 / 隐藏。隐藏只影响店面展示，评分与内容都不改。 */
export async function setReviewVisible(id: string, visible: boolean): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = readMock();
    const row = list.find((r) => r.id === id);
    if (row) row.visible = visible;
    writeMock(list);
    return;
  }
  await adminClient().setReviewVisible(id, visible);
}

/** 商家解释；传空串 = 清除解释。 */
export async function replyReview(id: string, content: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = readMock();
    const row = list.find((r) => r.id === id);
    if (row) row.reply = content.trim() ? content.trim() : null;
    writeMock(list);
    return;
  }
  await adminClient().replyReview(id, content);
}
