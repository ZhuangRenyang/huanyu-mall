import { getApiMode, getStoreClient } from './api';
import { getAccessToken } from './account';
import { loadMockCatalog, type StoreProduct } from './catalog';

/**
 * 商品收藏（店面，ADR-048）。
 *
 * 淘宝「收藏宝贝」：详情页一颗星、账户页一个收藏夹。
 * 全部需要登录；未登录时按钮引导去账户页，不做「先记本地、登录后补收藏」——
 * 那种半接状态最容易出现「收藏了却没进收藏夹」。
 */

const MOCK_KEY = 'favorites:mock';

export interface FavoriteList {
  items: StoreProduct[];
  count: number;
  hasMore: boolean;
}

function readMock(): string[] {
  try {
    const raw = sessionStorage.getItem(MOCK_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeMock(ids: string[]): void {
  try {
    sessionStorage.setItem(MOCK_KEY, JSON.stringify(ids));
  } catch {
    /* noop */
  }
}

/** 是否已收藏（详情页初始化按钮状态）。 */
export async function isFavorite(productId: string): Promise<boolean> {
  if (!getAccessToken()) return false;
  if (getApiMode() !== 'live') return readMock().includes(productId);
  try {
    const res = (await getStoreClient().listMyFavoriteIds()) as { product_ids?: string[] };
    return (res.product_ids ?? []).includes(productId);
  } catch {
    // 读不到就按未收藏处理：按钮还能点，点了会有明确报错
    return false;
  }
}

export async function addFavorite(productId: string): Promise<void> {
  if (getApiMode() !== 'live') {
    const ids = readMock();
    if (!ids.includes(productId)) writeMock([productId, ...ids]);
    return;
  }
  if (!getAccessToken()) throw new Error('请先登录后再收藏');
  await getStoreClient().addFavorite(productId);
}

export async function removeFavorite(productId: string): Promise<void> {
  if (getApiMode() !== 'live') {
    writeMock(readMock().filter((id) => id !== productId));
    return;
  }
  if (!getAccessToken()) throw new Error('请先登录后再收藏');
  await getStoreClient().removeFavorite(productId);
}

interface ApiFavoriteItem {
  id: string;
  title: string;
  handle: string;
  subtitle?: string | null;
  thumbnail_url?: string | null;
  price?: { amount_minor: number; currency_code: string } | null;
  available_quantity?: number;
}

/** 我的收藏（账户页）。 */
export async function fetchFavorites(params: { limit?: number; offset?: number } = {}): Promise<FavoriteList> {
  const limit = params.limit ?? 12;
  const offset = params.offset ?? 0;

  if (getApiMode() !== 'live') {
    // mock 模式：按 id 从演示目录取卡片，收藏夹不是空壳
    const ids = readMock();
    const { mockProducts } = await loadMockCatalog();
    const items = ids
      .map((id) => mockProducts.find((p) => p.id === id))
      .filter((p): p is StoreProduct => Boolean(p));
    return { items, count: items.length, hasMore: false };
  }

  const res = (await getStoreClient().listMyFavorites({
    limit,
    offset,
  })) as { items?: ApiFavoriteItem[]; count?: number; hasMore?: boolean };
  const items: StoreProduct[] = (res.items ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    subtitle: p.subtitle ?? undefined,
    thumbnail_url: p.thumbnail_url ?? undefined,
    status: 'published',
    price: p.price ?? undefined,
    available: p.available_quantity,
    categoryId: '',
    createdAt: '',
    attributes: [],
  }));
  return { items, count: res.count ?? items.length, hasMore: res.hasMore === true };
}
