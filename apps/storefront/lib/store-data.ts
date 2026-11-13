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
  sold_count?: number;
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
  /** 所属分类（详情接口返回，ADR-040）。 */
  categories?: Array<{ id: string; name: string; parent_id?: string | null }>;
  /** 商品级销量（ADR-067）。 */
  sold_count?: number;
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
  /** 可用量（各变体之和），0 = 已售罄（ADR-041）。 */
  available_quantity?: number;
  /** 商品级销量（ADR-067）。 */
  sold_count?: number;
}

/** 真 API 的分类。 */
interface ApiCategory {
  id: string;
  name: string;
  handle: string;
  parent_id?: string | null;
  product_count?: number;
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
    soldCount: v.sold_count ?? 0,
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
    categories: (d.categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parent_id ?? null,
    })),
    variants,
    soldCount: d.sold_count,
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
    available: p.available_quantity,
    soldCount: p.sold_count,
    originalMinor: undefined,
    badge: undefined,
    categoryId: "",
    createdAt: "",
    attributes: [],
  };
}

export interface StoreProfile {
  name: string;
  /** 客服电话（可空）：页脚与订单页展示。 */
  supportPhone: string | null;
  /** 店铺 Logo（可空）：有图显示图，没图显示店名文字（ADR-046）。 */
  logoUrl: string | null;
  /** 店铺公告（可空）：非空时在页头之上显示一条公告条（ADR-047）。 */
  announcement: string | null;
  /**
   * 退货收件地址（可空，ADR-053）：顾客退货时照着它寄回。
   * 未配置时前台要明说「联系客服」，不能让顾客对着空白框干等。
   */
  returnAddress: string | null;
}

const DEFAULT_PROFILE: StoreProfile = {
  name: '全球商城',
  supportPhone: null,
  logoUrl: null,
  announcement: null,
  returnAddress: null,
};

/**
 * 店铺资料（店名 / 客服电话，ADR-045）。
 *
 * 店名之前写死在页头与页脚两处；现在统一从店铺设置读，读不到就退回默认名 ——
 * 店名读失败不该让整页 500。
 */
export async function getStoreProfile(): Promise<StoreProfile> {
  if (getApiMode() !== 'live') return DEFAULT_PROFILE;
  try {
    const raw = (await getStoreClient().bootstrap()) as {
      theme?: {
        store_name?: string;
        support_phone?: string | null;
        logo_url?: string | null;
        announcement?: string | null;
        return_address?: string | null;
      } | null;
    };
    return {
      name: raw.theme?.store_name?.trim() || DEFAULT_PROFILE.name,
      supportPhone: raw.theme?.support_phone ?? null,
      logoUrl: raw.theme?.logo_url ?? null,
      announcement: raw.theme?.announcement?.trim() || null,
      returnAddress: raw.theme?.return_address?.trim() || null,
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export interface StoreProductsPage {
  items: StoreProduct[];
  /** 满足筛选条件的总条数（服务端分页用）。 */
  total: number;
  hasMore: boolean;
}

/**
 * 商品列表（分页版）。
 *
 * 改造前列表页不传 limit，服务端默认 20 条且前端没有分页控件 ——
 * 第 21 件商品顾客永远看不到（ADR-037）。分页必须在服务端做：
 * 前端本地切页等于先把全部商品拉下来，商品一多就废了。
 */
export async function getStoreProductsPage(query: ProductQuery = {}): Promise<StoreProductsPage> {
  if (getApiMode() !== "live") {
    const mock = await loadMockCatalog();
    const limit = query.limit ?? mock.mockProducts.length;
    const offset = query.offset ?? 0;
    return {
      items: mock.mockProducts.slice(offset, offset + limit),
      total: mock.mockProducts.length,
      hasMore: offset + limit < mock.mockProducts.length,
    };
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
  })) as { items?: ApiProductSummary[]; count?: number; hasMore?: boolean };
  const items = (res.items ?? []).map(mapSummary);
  return {
    items,
    total: res.count ?? items.length,
    hasMore: res.hasMore === true,
  };
}

/** 只要前 N 件时用它（首页「当季主推」），分页信息用 getStoreProductsPage。 */
export async function getStoreProducts(query: ProductQuery = {}): Promise<StoreProduct[]> {
  return (await getStoreProductsPage(query)).items;
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
    return (res.items ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      handle: c.handle,
      parentId: c.parent_id ?? null,
      productCount: c.product_count ?? 0,
    }));
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
