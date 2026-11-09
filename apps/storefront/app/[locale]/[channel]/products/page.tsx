import { ProductListing } from '@/components/product-listing';
import { getApiMode } from '@/lib/api';
import {
  getStoreAttributeGroups,
  getStoreCategories,
  getStoreProducts,
} from '@/lib/store-data';

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

  // live：筛选与排序交给服务端；mock：本地数据 + 前端本地筛选
  const [products, categories, attributeGroups] = await Promise.all([
    getStoreProducts({ q: initialQuery, category: initialCategory, sort }),
    getStoreCategories(),
    getStoreAttributeGroups(),
  ]);

  return (
    <ProductListing
      products={products}
      categories={categories}
      attributeGroups={attributeGroups}
      basePath={`/${locale}/${channel}`}
      initialQuery={initialQuery}
      initialCategory={initialCategory || undefined}
      serverFiltered={live}
    />
  );
}
