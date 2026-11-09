import type { Money } from "@mall/sdk";
import {
  loadMockCatalog,
  type CatalogImage,
  type CatalogProduct,
  type CatalogVariant,
  type MockCategory,
  type StoreProduct,
} from "./catalog";
import { getApiMode, getStoreClient } from "./api";

/**
 * 店面取数层（服务端）：live 模式打真 API，mock 模式用本地数据。
 * 统一出口，页面只认这里的函数——切模式不用改页面。
 */

/** 真 API 返回的变体（字段对齐 openapi VariantSummary）。 */
interface ApiVariant {
  id: string;
  title: string;
  sku?: string;
  status?: string;
  options?: Record<string, string>;
  price?: Money;
  inventory_status?: string;
  available_quantity?: number;
}

/** 真 API 返回的商品详情（字段对齐 openapi ProductDetail）。 */
interface ApiProductDetail {
  id: string;
  title: string;
  handle: string;
  subtitle?: string | null;
  description?: string | null;
  status?: string;
  images?: Array<{ id: string; url: string; alt?: string | null }>;
  variants?: ApiVariant[];
  attributes?: Array<{ name: string; value: string }>;
}

/** 真 API 返回的商品摘要（字段对齐 openapi ProductSummary）。 */
interface ApiProductSummary {
  id: string;
  title: string;
  handle: string;
  subtitle?: string | null;
  thumbnail_url?: string | null;
  status?: string;
  price?: Money;
}

/** 真 API 的分类。 */
interface ApiCategory {
  id: string;
  name: string;
  handle: string;
  parent_id?: string | null;
}

export interface ProductQuery {
  q?: string;
  category?: string;
  sort?: string;
  attribute?: Record<string, string[]>;
  limit?: number;
  offset?: number;
}

function mapVariant(v: ApiVariant): CatalogVariant {
  return {
    id: v.id,
    title: v.title,
    options: v.options ?? {},
    priceMinor: v.price?.amount_minor ?? 0,
    stock: v.available_quantity ?? 0,
  };
}

function mapDetail(d: ApiProductDetail): CatalogProduct {
  const images: CatalogImage[] = (d.images ?? []).map((img) => ({
    id: img.id,
    url: img.url,
    alt: img.alt ?? undefined,
  }));
  const variants = (d.variants ?? []).map(mapVariant);
  return {
    id: d.id,
    title: d.title,
    handle: d.handle,
    subtitle: d.subtitle ?? undefined,
    description: d.description ?? "",
    categoryId: "",
    createdAt: "",
    images,
    attributes: (d.attributes ?? []).map((a) => ({ name: a.name, value: a.value })),
    variants,
    originalMinor: undefined,
  };
}

function mapSummary(p: ApiProductSummary): StoreProduct {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    subtitle: p.subtitle ?? undefined,
    thumbnail_url: p.thumbnail_url ?? undefined,
    status: (p.status ?? "published") as StoreProduct["status"],
    price: p.price,
    originalMinor: undefined,
    badge: undefined,
    categoryId: "",
    createdAt: "",
    attributes: [],
  };
}

/** 商品列表（live 走服务端筛选排序，mock 走本地数据 + 前端本地筛选）。 */
export async function getStoreProducts(query: ProductQuery = {}): Promise<StoreProduct[]> {
  if (getApiMode() !== "live") {
    const mock = await loadMockCatalog();
    return mock.mockProducts;
  }

  const attrs: Record<string, string> = {};
  for (const [name, values] of Object.entries(query.attribute ?? {})) {
    if (values.length > 0) attrs[name] = values.join(",");
  }
  const res = (await getStoreClient().listProducts({
    q: query.q,
    category: query.category,
    sort: query.sort,
    limit: query.limit,
    offset: query.offset,
    ...attrs,
  })) as { items?: ApiProductSummary[] };
  return (res.items ?? []).map(mapSummary);
}

/** 商品详情（PDP）。 */
export async function getStoreProduct(handle: string): Promise<CatalogProduct | undefined> {
  if (getApiMode() !== "live") {
    const mock = await loadMockCatalog();
    return mock.getProductByHandle(handle);
  }
  try {
    const d = (await getStoreClient().getProduct(handle)) as ApiProductDetail;
    return mapDetail(d);
  } catch {
    return undefined;
  }
}

/** 分类列表。 */
export async function getStoreCategories(): Promise<MockCategory[]> {
  if (getApiMode() !== "live") {
    const mock = await loadMockCatalog();
    return mock.mockCategories;
  }
  try {
    const res = (await getStoreClient().listCategories()) as { items?: ApiCategory[] };
    return (res.items ?? []).map((c) => ({ id: c.id, name: c.name, handle: c.handle }));
  } catch {
    return [];
  }
}

/** 属性分组（live 模式筛选交给服务端，前端不再本地过滤属性）。 */
export async function getStoreAttributeGroups() {
  if (getApiMode() !== "live") {
    const mock = await loadMockCatalog();
    return mock.attributeGroups;
  }
  return [];
}
