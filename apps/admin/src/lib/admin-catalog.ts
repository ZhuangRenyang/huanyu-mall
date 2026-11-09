import type { ProductDraft, VariantDraft } from './admin-data';
import { adminClient, getAdminApiMode } from './admin-client';
import {
  deleteProduct as mockDeleteProduct,
  listProducts as mockListProducts,
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
  };
}

export async function listProducts(): Promise<ProductDraft[]> {
  if (getAdminApiMode() !== 'live') return mockListProducts();
  const res = (await adminClient().listProducts({ limit: 100 })) as {
    items?: ApiProduct[];
  };
  return (res.items ?? []).map(mapProduct);
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
    })) as ApiProduct;
    for (const v of product.variants) {
      await client.createVariant(created.id, {
        sku: v.sku,
        title: v.title,
        prices: [{ amount_minor: v.priceMinor, currency_code: 'CNY' }],
      });
    }
    return;
  }
  await client.updateProduct(product.id, {
    title: product.title,
    subtitle: product.subtitle ?? null,
    status: product.status,
  });
}

export async function deleteProduct(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockDeleteProduct(id);
    return;
  }
  await adminClient().deleteProduct(id);
}
