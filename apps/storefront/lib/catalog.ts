import type { ProductSummary } from '@mall/sdk';

/**
 * 店面商品目录（mock 单一数据源）。
 * 列表（首页/PLP）用 StoreProduct；详情（PDP）用 CatalogProduct（含变体/图/属性）。
 * 真实接入后，这些数据由 @mall/sdk 的 API 返回，字段结构保持一致即可无缝切换。
 */

export interface CatalogVariant {
  id: string;
  title: string;
  /** 规格组合，如 { 颜色: '黑色' }。 */
  options: Record<string, string>;
  priceMinor: number;
  originalMinor?: number;
  /** 可用库存。0 = 售罄。 */
  stock: number;
}

export interface CatalogImage {
  id: string;
  url: string;
  alt?: string;
}

export interface CatalogProduct {
  id: string;
  title: string;
  handle: string;
  subtitle?: string;
  description: string;
  categoryId: string;
  /** ISO 日期，用于 created_at.desc 排序。 */
  createdAt: string;
  images: CatalogImage[];
  attributes: { name: string; value: string }[];
  /** 所属分类（面包屑与内链用，ADR-040）。 */
  categories?: Array<{ id: string; name: string; parentId: string | null }>;
  variants: CatalogVariant[];
  badge?: string;
  /** 列表划线原价（促销）。 */
  originalMinor?: number;
}

/** 列表/卡片展示模型（在 SDK ProductSummary 之上补检索与促销字段）。 */
export interface StoreProduct extends ProductSummary {
  /** 可用量（各变体之和）：0 = 已售罄，列表卡片据此打标（ADR-041）。 */
  available?: number;
  originalMinor?: number;
  badge?: string;
  categoryId: string;
  createdAt: string;
  attributes: { name: string; value: string }[];
}

export interface MockCategory {
  id: string;
  name: string;
  handle: string;
  /** 父分类；null/undefined = 一级分类（ADR-028 只做两级）。 */
  parentId?: string | null;
  /** 该类下上架中的商品数（店面只算已上架）。 */
  productCount?: number;
}

export interface AttributeGroup {
  name: string;
  values: string[];
}

/**
 * 动态加载 mock 数据：live 模式根本不会加载它，
 * 假数据不会被打进首屏 bundle（省体积，也避免 mock 与真数据混用）。
 */
export async function loadMockCatalog(): Promise<typeof import('./catalog-mock')> {
  return import('./catalog-mock');
}
