/** M01 Product DTO 与 repository/service 契约（对齐架构 §2.1）。 */

export type ProductStatus = "draft" | "published" | "archived";
export type AttributeInputType = "dropdown" | "multiselect" | "swatch" | "boolean" | "numeric" | "text";

export interface ProductDTO {
  id: string;
  title: string;
  handle: string;
  subtitle: string | null;
  description: string | null;
  status: ProductStatus;
  thumbnail_file_id: string | null;
  product_type_id: string | null;
  /** 运费模板 id；NULL = 用默认模板（对齐淘宝发布页的「运费模板」）。 */
  shipping_profile_id: string | null;
  /** 卖家包邮：该商品不产生运费。 */
  free_shipping: boolean;
  metadata: Record<string, unknown> | null;
  /** ISO 时间，用于 created_at.desc 排序。 */
  created_at: string;
}

/** 列表项（含变体）：供批量计价用，禁 N+1。 */
export interface ProductListItemDTO extends ProductDTO {
  variants: VariantDTO[];
}

export interface VariantDTO {
  id: string;
  product_id: string;
  sku: string;
  title: string;
  options: Record<string, string>;
  allow_backorder: boolean;
  status: ProductStatus;
}

export interface ImageDTO {
  id: string;
  product_id: string;
  file_id: string;
  alt: string | null;
  sort_order: number;
  is_primary: boolean;
}

export interface ProductDetailDTO extends ProductDTO {
  variants: VariantDTO[];
  images: ImageDTO[];
}

export interface ProductTypeDTO {
  id: string;
  name: string;
}

export interface AttributeDTO {
  id: string;
  name: string;
  handle: string;
  input_type: AttributeInputType;
  is_filterable: boolean;
  is_translatable: boolean;
}

export interface AttributeValueDTO {
  id: string;
  attribute_id: string;
  value: string;
  label: string;
  sort_order: number;
}

export interface CreateVariantInput {
  sku: string;
  title: string;
  options?: Record<string, string>;
  allowBackorder?: boolean;
  status?: ProductStatus;
}

export interface CreateImageInput {
  fileId: string;
  alt?: string;
  sortOrder?: number;
  isPrimary?: boolean;
}

export interface CreateProductInput {
  title: string;
  handle: string;
  subtitle?: string;
  description?: string;
  status?: ProductStatus;
  productTypeId?: string | null;
  thumbnailFileId?: string | null;
  shippingProfileId?: string | null;
  freeShipping?: boolean;
  metadata?: Record<string, unknown> | null;
  variants?: CreateVariantInput[];
  images?: CreateImageInput[];
  categoryIds?: string[];
}

export interface UpdateProductInput {
  title?: string;
  handle?: string;
  subtitle?: string | null;
  description?: string | null;
  status?: ProductStatus;
  thumbnailFileId?: string | null;
  productTypeId?: string | null;
  shippingProfileId?: string | null;
  freeShipping?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface ProductQuery {
  limit?: number;
  offset?: number;
  status?: ProductStatus;
  handle?: string;
  /** 标题模糊搜索。 */
  q?: string;
  /** 分类过滤（product_category_link）。 */
  categoryId?: string;
  /** 排序：created_at.desc | title.asc | title.desc。价格排序在路由层按批量计价结果排。 */
  sort?: string;
}

export interface SellableVariantQuery {
  channelId: string;
  locale?: string;
  productIds?: string[];
  limit?: number;
  offset?: number;
}

/** 可售变体：variant 字段 + links 关联出的 price_set_id（价格由 M02 计算，不在本模块）。 */
export interface SellableVariantDTO {
  id: string;
  product_id: string;
  sku: string;
  title: string;
  options: Record<string, string>;
  allow_backorder: boolean;
  price_set_id: string | null;
}

export interface ProductRepository {
  findById(id: string): Promise<ProductDTO | null>;
  list(q: ProductQuery): Promise<{ items: ProductDTO[]; count: number }>;
  insert(input: CreateProductInput & { id: string }): Promise<ProductDTO>;
  update(id: string, patch: UpdateProductInput): Promise<ProductDTO | null>;
  softDelete(id: string): Promise<void>;
  /** 各状态的商品数（列表页签角标用，一次 GROUP BY）。 */
  countByStatus(): Promise<Record<string, number>>;
  /** 批量改状态（一条 SQL，不做 N 次单条更新）。 */
  bulkUpdateStatus(ids: string[], status: ProductStatus): Promise<number>;
  /** 批量软删。 */
  bulkSoftDelete(ids: string[]): Promise<number>;
  listVariantsByIds(ids: string[]): Promise<VariantDTO[]>;
  listVariantsByProductIds(productIds: string[]): Promise<VariantDTO[]>;
  updateVariant(variantId: string, patch: { title?: string; status?: ProductStatus }): Promise<VariantDTO | null>;
  listImagesByProductId(productId: string): Promise<ImageDTO[]>;
  createVariants(productId: string, variants: CreateVariantInput[]): Promise<VariantDTO[]>;
  createImages(productId: string, images: CreateImageInput[]): Promise<void>;
  /** 软删该商品所有图片（整组替换前调用）。 */
  softDeleteImages(productId: string): Promise<void>;
  linkCategories(productId: string, categoryIds: string[]): Promise<void>;
  /** product_category_link：批量查「商品 → 分类」映射（供 promotion 目录促销算折扣，禁 N+1）。 */
  listCategoryIdsByProducts(productIds: string[]): Promise<Array<{ productId: string; categoryIds: string[] }>>;
  /** 批量查商品的运费归属（模板 + 是否卖家包邮），供购物车分组算运费。 */
  listShippingInfoByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; profileId: string | null; freeShipping: boolean }>>;
  /** product_channel link：返回该渠道可见的商品 id（is_visible=true）。 */
  listSellableProductIds(channelId: string): Promise<string[]>;
  /** variant_price_set link：批量取 price_set_id（禁循环）。 */
  priceSetIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>>;
  createProductType(name: string): Promise<ProductTypeDTO>;
  createAttribute(input: {
    name: string;
    handle: string;
    inputType: AttributeInputType;
    isFilterable?: boolean;
    isTranslatable?: boolean;
  }): Promise<AttributeDTO>;
  createAttributeValue(input: {
    attributeId: string;
    value: string;
    label: string;
    sortOrder?: number;
  }): Promise<AttributeValueDTO>;
}

export interface IProductModuleService {
  listProducts(q: ProductQuery): Promise<{ items: ProductDTO[]; count: number }>;
  /** 列表 + 批量变体（供批量计价，禁 N+1）。 */
  listProductsWithVariants(q: ProductQuery): Promise<{ items: ProductListItemDTO[]; count: number }>;
  retrieveProduct(id: string, opts?: { withVariants?: boolean }): Promise<ProductDetailDTO>;
  createProduct(input: CreateProductInput): Promise<ProductDetailDTO>;
  updateProduct(id: string, patch: UpdateProductInput): Promise<ProductDTO>;
  /** 整组替换商品图片；第一张自动成为主图（thumbnail_file_id）。 */
  replaceProductImages(productId: string, fileIds: string[]): Promise<ProductDetailDTO>;
  /** 各状态的商品数（页签角标）。 */
  countByStatus(): Promise<Record<string, number>>;
  /** 批量改状态 / 批量删除，返回实际影响条数。 */
  bulkUpdateStatus(ids: string[], status: ProductStatus): Promise<number>;
  bulkDelete(ids: string[]): Promise<number>;
  deleteProduct(id: string): Promise<void>;
  createVariant(productId: string, input: CreateVariantInput): Promise<VariantDTO>;
  updateVariant(variantId: string, patch: { title?: string; status?: ProductStatus }): Promise<VariantDTO>;
  listVariantsByIds(ids: string[]): Promise<VariantDTO[]>;
  resolveSellableVariants(q: SellableVariantQuery): Promise<{ items: SellableVariantDTO[]; count: number }>;
  /** 批量查「商品 → 分类」映射（供 promotion 目录促销算折扣）。 */
  listCategoryIdsByProducts(productIds: string[]): Promise<Array<{ productId: string; categoryIds: string[] }>>;
  /** 批量查商品的运费归属（模板 + 是否卖家包邮），供购物车分组算运费。 */
  listShippingInfoByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; profileId: string | null; freeShipping: boolean }>>;
}
