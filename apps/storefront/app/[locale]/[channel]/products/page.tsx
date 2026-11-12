import { ProductListing } from '@/components/product-listing';
import { getApiMode } from '@/lib/api';
import {
  getStoreAttributeGroups,
  getStoreCategories,
  getStoreProductsPage,
} from '@/lib/store-data';

/** 一页 24 件：4 列 × 6 行，桌面一屏多一点，和多数商城列表页一致。 */
const PAGE_SIZE = 24;

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; channel: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next.js 16：params / searchParams 均为 Promise，必须 await。
  const { locale, channel } = await params;
  const sp = await searchParams;
  const initialQuery = typeof sp.q === 'string' ? sp.q : '';
  const initialCategory = typeof sp.category === 'string' ? sp.category : '';
  const sort = typeof sp.sort === 'string' ? sp.sort : 'created_at.desc';
  const live = getApiMode() === 'live';
  const rawPage = typeof sp.page === 'string' ? Number(sp.page) : 1;
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  // live：筛选、排序、分页都交给服务端；mock：本地数据 + 前端本地筛选
  const [result, categories, attributeGroups] = await Promise.all([
    getStoreProductsPage({
      q: initialQuery,
      category: initialCategory,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getStoreCategories(),
    getStoreAttributeGroups(),
  ]);

  return (
    <ProductListing
      products={result.items}
      categories={categories}
      attributeGroups={attributeGroups}
      basePath={`/${locale}/${channel}`}
      initialQuery={initialQuery}
      initialCategory={initialCategory || undefined}
      initialSort={sort}
      serverFiltered={live}
      page={page}
      pageSize={PAGE_SIZE}
      total={result.total}
      hasMore={result.hasMore}
    />
  );
}
