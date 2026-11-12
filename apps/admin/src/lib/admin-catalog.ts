import type { ProductDraft, ProductImageDraft, VariantDraft } from './admin-data';
import { adminClient, getAdminApiMode } from './admin-client';
import {
  deleteProduct as mockDeleteProduct,
  listProducts as mockListProducts,
  replaceProducts as mockReplaceProducts,
  saveProduct as mockSaveProduct,
} from './admin-store';

/**
 * 商品目录域：列表 / 新建更新 / 删除。
 *
 * 后端返回 snake_case，界面用 camelCase 的视图模型 —— 映射只在这一域内发生。
 */

interface ApiProduct {
  id: string;
  title: string;
  handle: string;
  subtitle?: string | null;
  status: string;
  created_at?: string;
  shipping_profile_id?: string | null;
  free_shipping?: boolean;
  description?: string | null;
  thumbnail_url?: string | null;
  /** 仅详情接口返回：所属分类。 */
  category_ids?: string[];
  images?: Array<{ file_id: string; url?: string | null }>;
  variants?: Array<{
    id: string;
    sku: string;
    title: string;
    status: string;
    options?: Record<string, string> | null;
    price?: { amount_minor: number; currency_code: string };
    available_quantity?: number;
  }>;
}

function mapVariant(v: NonNullable<ApiProduct['variants']>[number]): VariantDraft {
  return {
    id: v.id,
    sku: v.sku,
    title: v.title,
    priceMinor: v.price?.amount_minor ?? 0,
    stock: v.available_quantity ?? 0,
  };
}

function mapProduct(p: ApiProduct): ProductDraft {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    subtitle: p.subtitle ?? undefined,
    status: p.status as ProductDraft['status'],
    variants: (p.variants ?? []).map(mapVariant),
    createdAt: p.created_at ?? '',
    shippingProfileId: p.shipping_profile_id ?? null,
    freeShipping: p.free_shipping ?? false,
    categoryIds: p.category_ids ?? [],
    description: p.description ?? '',
    thumbnailUrl: p.thumbnail_url ?? null,
    images: (p.images ?? []).map((i) => ({ fileId: i.file_id, url: i.url ?? null })),
  };
}

export interface ProductListQuery {
  status?: 'draft' | 'published' | 'archived';
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ProductListResult {
  items: ProductDraft[];
  /** 满足筛选条件的总条数（服务端分页用）。 */
  total: number;
  counts: { all: number; published: number; draft: number };
}

/**
 * 商品列表：分页与筛选都在服务端。
 *
 * 之前是一次拉 100 条再本地 slice —— 商品超过 100 就静默漏，且页签角标不准。
 */
export async function listProducts(q: ProductListQuery = {}): Promise<ProductListResult> {
  if (getAdminApiMode() !== 'live') {
    // mock：本地过滤 + 分页，行为与后端一致
    let all = mockListProducts();
    if (q.status) all = all.filter((p) => p.status === q.status);
    if (q.q) {
      const needle = q.q.toLowerCase();
      all = all.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) || p.handle.toLowerCase().includes(needle),
      );
    }
    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;
    const counts = { all: mockListProducts().length, published: 0, draft: 0 };
    for (const p of mockListProducts()) {
      if (p.status === 'published') counts.published += 1;
      else counts.draft += 1;
    }
    return { items: all.slice(offset, offset + limit), total: all.length, counts };
  }

  const res = (await adminClient().listProducts({
    limit: q.limit ?? 20,
    offset: q.offset ?? 0,
    ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { q: q.q } : {}),
  })) as {
    items?: ApiProduct[];
    count?: number;
    counts?: { all: number; published: number; draft: number };
  };
  return {
    items: (res.items ?? []).map(mapProduct),
    total: res.count ?? 0,
    counts: res.counts ?? { all: 0, published: 0, draft: 0 },
  };
}

/** 批量上架 / 下架 / 删除，返回实际生效条数。 */
export async function bulkProductAction(
  ids: string[],
  action: 'publish' | 'unpublish' | 'delete',
): Promise<{ requested: number; affected: number }> {
  if (getAdminApiMode() !== 'live') {
    if (action === 'delete') {
      const all = mockListProducts().filter((p) => !ids.includes(p.id));
      mockReplaceProducts(all);
      return { requested: ids.length, affected: ids.length };
    }
    const all = mockListProducts().map((p) =>
      ids.includes(p.id) ? { ...p, status: action === 'publish' ? 'published' : 'draft' } : p,
    ) as ProductDraft[];
    mockReplaceProducts(all);
    return { requested: ids.length, affected: ids.length };
  }
  const res = (await adminClient().bulkProductAction({ ids, action })) as {
    requested?: number;
    affected?: number;
  };
  return { requested: res.requested ?? ids.length, affected: res.affected ?? 0 };
}

export async function saveProduct(product: ProductDraft): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSaveProduct(product);
    return;
  }
  const client = adminClient();
  const existing = product.id.startsWith('prod_') ? product.id : '';
  if (!existing || existing.startsWith('new_')) {
    const created = (await client.createProduct({
      title: product.title,
      handle: product.handle,
      subtitle: product.subtitle ?? null,
      shipping_profile_id: product.shippingProfileId ?? null,
      free_shipping: product.freeShipping ?? false,
      ...(product.categoryIds ? { category_ids: product.categoryIds } : {}),
    })) as ApiProduct;
    for (const v of product.variants) {
      await client.createVariant(created.id, {
        sku: v.sku,
        title: v.title,
        prices: [{ amount_minor: v.priceMinor, currency_code: 'CNY' }],
      });
    }
    // 新建时也要落图片与描述：漏了就是「建完有图、编辑又没了」
    if (product.description) {
      await client.updateProduct(created.id, { description: product.description });
    }
    if (product.images?.length) {
      await client.replaceProductImages(created.id, {
        file_ids: product.images.map((i) => i.fileId),
      });
    }
    return;
  }
  await client.updateProduct(product.id, {
    title: product.title,
    subtitle: product.subtitle ?? null,
    description: product.description ?? null,
    status: product.status,
    shipping_profile_id: product.shippingProfileId ?? null,
    free_shipping: product.freeShipping ?? false,
    ...(product.categoryIds ? { category_ids: product.categoryIds } : {}),
  });
  // 图片单独走整组替换（第一张即主图），顺序由界面决定
  if (product.images) {
    await client.replaceProductImages(
      product.id,
      { file_ids: product.images.map((i) => i.fileId) },
    );
  }
}

/**
 * 上传一张商品图片。
 *
 * live：读成 base64 走 `POST /admin/files`（后端 20MB 上限，前端先拦一道）。
 * mock：直接转 dataURL，仅内存有效 —— 演示够用，刷新会丢，不写 localStorage 免得撑爆配额。
 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function uploadProductImage(file: File): Promise<ProductImageDraft> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片超过 20MB，请压缩后再传');
  if (!file.type.startsWith('image/')) throw new Error('只能上传图片文件');

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });

  if (getAdminApiMode() !== 'live') {
    return { fileId: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, url: dataUrl };
  }

  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const uploaded = (await adminClient().uploadFile({
    filename: file.name,
    content_type: file.type,
    data_base64: base64,
  })) as { id?: string; url?: string };
  if (!uploaded.id) throw new Error('上传失败：服务端未返回文件 id');
  return { fileId: uploaded.id, url: uploaded.url ?? null };
}

export async function deleteProduct(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockDeleteProduct(id);
    return;
  }
  await adminClient().deleteProduct(id);
}
