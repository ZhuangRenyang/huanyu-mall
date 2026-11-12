import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  AttributeDTO,
  AttributeInputType,
  AttributeValueDTO,
  CategoryDTO,
  CreateImageInput,
  CreateProductInput,
  CreateVariantInput,
  ImageDTO,
  ProductDTO,
  ProductQuery,
  ProductRepository,
  ProductStatus,
  ProductTypeDTO,
  UpdateCategoryInput,
  UpdateProductInput,
  VariantDTO,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleProductRepository implements ProductRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<ProductDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.product)
      .where(and(eq(schema.product.id, id), isNull(schema.product.deletedAt)))
      .limit(1);
    return rows[0] ? toProductDTO(rows[0]) : null;
  }

  async list(q: ProductQuery): Promise<{ items: ProductDTO[]; count: number }> {
    const conditions = [isNull(schema.product.deletedAt)];
    if (q.status) conditions.push(eq(schema.product.status, q.status));
    if (q.handle) conditions.push(eq(schema.product.handle, q.handle));
    if (q.q) conditions.push(sql`${schema.product.title} ILIKE ${`%${q.q}%`}`);
    if (q.categoryId) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM product_category_link pcl
         WHERE pcl.product_id = ${schema.product.id}
           AND pcl.category_id = ${q.categoryId}
           AND pcl.deleted_at IS NULL
      )`);
    }
    const where = and(...conditions);
    const order =
      q.sort === "title.asc"
        ? asc(schema.product.title)
        : q.sort === "title.desc"
          ? desc(schema.product.title)
          : desc(schema.product.createdAt);
    const rows = await this.db
      .select()
      .from(schema.product)
      .where(where)
      .orderBy(order)
      .limit(q.limit ?? 20)
      .offset(q.offset ?? 0);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.product)
      .where(where);
    return { items: rows.map(toProductDTO), count: countRows[0]?.count ?? 0 };
  }

  async insert(input: CreateProductInput & { id: string }): Promise<ProductDTO> {
    const rows = await this.db
      .insert(schema.product)
      .values({
        id: input.id,
        title: input.title,
        handle: input.handle,
        subtitle: input.subtitle ?? null,
        description: input.description ?? null,
        status: input.status ?? "draft",
        thumbnailFileId: input.thumbnailFileId ?? null,
        productTypeId: input.productTypeId ?? null,
        shippingProfileId: input.shippingProfileId ?? null,
        freeShipping: input.freeShipping ?? false,
        metadata: input.metadata ?? null,
      })
      .returning();
    return toProductDTO(rows[0]!);
  }

  async update(id: string, patch: UpdateProductInput): Promise<ProductDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.handle !== undefined) set.handle = patch.handle;
    if (patch.subtitle !== undefined) set.subtitle = patch.subtitle;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.thumbnailFileId !== undefined) set.thumbnailFileId = patch.thumbnailFileId;
    if (patch.productTypeId !== undefined) set.productTypeId = patch.productTypeId;
    if (patch.shippingProfileId !== undefined) set.shippingProfileId = patch.shippingProfileId;
    if (patch.freeShipping !== undefined) set.freeShipping = patch.freeShipping;
    if (patch.metadata !== undefined) set.metadata = patch.metadata;
    const rows = await this.db
      .update(schema.product)
      .set(set)
      .where(and(eq(schema.product.id, id), isNull(schema.product.deletedAt)))
      .returning();
    return rows[0] ? toProductDTO(rows[0]) : null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(schema.product)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.product.id, id));
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: schema.product.status, n: sql<number>`count(*)::int` })
      .from(schema.product)
      .where(isNull(schema.product.deletedAt))
      .groupBy(schema.product.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }

  async bulkUpdateStatus(ids: string[], status: string): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(schema.product)
      .set({ status, updatedAt: new Date() })
      .where(and(inArray(schema.product.id, ids), isNull(schema.product.deletedAt)))
      .returning({ id: schema.product.id });
    return rows.length;
  }

  async bulkSoftDelete(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(schema.product)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(schema.product.id, ids), isNull(schema.product.deletedAt)))
      .returning({ id: schema.product.id });
    return rows.length;
  }

  async listVariantsByIds(ids: string[]): Promise<VariantDTO[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.productVariant)
      .where(and(inArray(schema.productVariant.id, ids), isNull(schema.productVariant.deletedAt)));
    return rows.map(toVariantDTO);
  }

  async listVariantsByProductIds(productIds: string[]): Promise<VariantDTO[]> {
    if (productIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.productVariant)
      .where(
        and(inArray(schema.productVariant.productId, productIds), isNull(schema.productVariant.deletedAt)),
      );
    return rows.map(toVariantDTO);
  }

  async updateVariant(
    variantId: string,
    patch: { title?: string; status?: ProductStatus },
  ): Promise<VariantDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.status !== undefined) set.status = patch.status;
    const rows = await this.db
      .update(schema.productVariant)
      .set(set)
      .where(and(eq(schema.productVariant.id, variantId), isNull(schema.productVariant.deletedAt)))
      .returning();
    return rows[0] ? toVariantDTO(rows[0]) : null;
  }

  async listImagesByProductId(productId: string): Promise<ImageDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.productImage)
      .where(and(eq(schema.productImage.productId, productId), isNull(schema.productImage.deletedAt)));
    return rows.map(toImageDTO);
  }

  async softDeleteImages(productId: string): Promise<void> {
    await this.db
      .update(schema.productImage)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(schema.productImage.productId, productId), isNull(schema.productImage.deletedAt)),
      );
  }

  async createVariants(productId: string, variants: CreateVariantInput[]): Promise<VariantDTO[]> {
    if (variants.length === 0) return [];
    const rows = await this.db
      .insert(schema.productVariant)
      .values(
        variants.map((v) => ({
          id: prefixedUlid("var"),
          productId,
          sku: v.sku,
          title: v.title,
          options: v.options ?? {},
          allowBackorder: v.allowBackorder ?? false,
          status: v.status ?? "draft",
        })),
      )
      .returning();
    return rows.map(toVariantDTO);
  }

  async createImages(productId: string, images: CreateImageInput[]): Promise<void> {
    if (images.length === 0) return;
    await this.db.insert(schema.productImage).values(
      images.map((i) => ({
        id: prefixedUlid("pimg"),
        productId,
        fileId: i.fileId,
        alt: i.alt ?? null,
        sortOrder: i.sortOrder ?? 0,
        isPrimary: i.isPrimary ?? false,
      })),
    );
  }

  async linkCategories(productId: string, categoryIds: string[]): Promise<void> {
    if (categoryIds.length === 0) return;
    await this.db
      .insert(schema.productCategoryLink)
      .values(categoryIds.map((categoryId) => ({ id: prefixedUlid("pcat"), productId, categoryId })));
  }

  /** 整组替换分类关联：先清后插，同一事务（后台一次提交整组，前端不做增量 diff）。 */
  async replaceCategories(productId: string, categoryIds: string[]): Promise<void> {
    const unique = [...new Set(categoryIds)].filter(Boolean);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.productCategoryLink)
        .where(eq(schema.productCategoryLink.productId, productId));
      if (unique.length === 0) return;
      await tx.insert(schema.productCategoryLink).values(
        unique.map((categoryId) => ({
          id: prefixedUlid("pcat"),
          productId,
          categoryId,
        })),
      );
    });
  }

  // —— 分类（ADR-028）——

  async listCategories(publishedOnly = false): Promise<CategoryDTO[]> {
    const [rows, counts] = await Promise.all([
      this.db
        .select()
        .from(schema.productCategory)
        .where(isNull(schema.productCategory.deletedAt))
        .orderBy(asc(schema.productCategory.sortOrder), asc(schema.productCategory.name)),
      this.countProductsByCategory(publishedOnly),
    ]);
    return rows.map((r) => toCategoryDTO(r, counts.get(r.id) ?? 0));
  }

  async findCategoryById(id: string): Promise<CategoryDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.productCategory)
      .where(and(eq(schema.productCategory.id, id), isNull(schema.productCategory.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const counts = await this.countProductsByCategory();
    return toCategoryDTO(row, counts.get(row.id) ?? 0);
  }

  async findCategoryByHandle(handle: string): Promise<CategoryDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.productCategory)
      .where(and(eq(schema.productCategory.handle, handle), isNull(schema.productCategory.deletedAt)))
      .limit(1);
    return rows[0] ? toCategoryDTO(rows[0], 0) : null;
  }

  async insertCategory(input: {
    id: string;
    name: string;
    handle: string;
    parentId: string | null;
    sortOrder: number;
  }): Promise<CategoryDTO> {
    const rows = await this.db
      .insert(schema.productCategory)
      .values({
        id: input.id,
        name: input.name,
        handle: input.handle,
        parentId: input.parentId,
        sortOrder: input.sortOrder,
      })
      .returning();
    return toCategoryDTO(rows[0]!, 0);
  }

  async updateCategory(id: string, patch: UpdateCategoryInput): Promise<CategoryDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.handle !== undefined) set.handle = patch.handle;
    if (patch.parentId !== undefined) set.parentId = patch.parentId;
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
    const rows = await this.db
      .update(schema.productCategory)
      .set(set)
      .where(and(eq(schema.productCategory.id, id), isNull(schema.productCategory.deletedAt)))
      .returning();
    if (!rows[0]) return null;
    const counts = await this.countProductsByCategory();
    return toCategoryDTO(rows[0], counts.get(id) ?? 0);
  }

  async softDeleteCategory(id: string): Promise<void> {
    await this.db
      .update(schema.productCategory)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.productCategory.id, id));
  }

  async countProductsByCategory(publishedOnly = false): Promise<Map<string, number>> {
    const conditions = [isNull(schema.product.deletedAt)];
    // 店面只该看到「上架中」的数量：把草稿算进去会让分类页写着 10 件、点开只有 3 件
    if (publishedOnly) conditions.push(eq(schema.product.status, "published"));
    const rows = await this.db
      .select({
        categoryId: schema.productCategoryLink.categoryId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.productCategoryLink)
      .innerJoin(schema.product, eq(schema.product.id, schema.productCategoryLink.productId))
      .where(and(...conditions))
      .groupBy(schema.productCategoryLink.categoryId);
    return new Map(rows.map((r) => [r.categoryId, Number(r.count)]));
  }

  /** 批量取商品的运费归属（模板 + 卖家包邮），禁 N+1。 */
  async listShippingInfoByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; profileId: string | null; freeShipping: boolean }>> {
    if (productIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: schema.product.id,
        profileId: schema.product.shippingProfileId,
        freeShipping: schema.product.freeShipping,
      })
      .from(schema.product)
      .where(and(inArray(schema.product.id, productIds), isNull(schema.product.deletedAt)));
    return rows.map((r) => ({
      productId: r.id,
      profileId: r.profileId ?? null,
      freeShipping: r.freeShipping,
    }));
  }

  async listCategoryIdsByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; categoryIds: string[] }>> {
    if (productIds.length === 0) return [];
    // product_category_link 无 deleted_at，靠 uq_pcat(product_id, category_id) 唯一，仍按 Set 去重兜底。
    const rows = await this.db
      .select({
        productId: schema.productCategoryLink.productId,
        categoryId: schema.productCategoryLink.categoryId,
      })
      .from(schema.productCategoryLink)
      .where(inArray(schema.productCategoryLink.productId, productIds));
    const byProduct = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = byProduct.get(r.productId) ?? new Set<string>();
      set.add(r.categoryId);
      byProduct.set(r.productId, set);
    }
    return [...byProduct.entries()].map(([productId, categoryIds]) => ({
      productId,
      categoryIds: [...categoryIds],
    }));
  }

  async listSellableProductIds(channelId: string): Promise<string[]> {
    const res = await this.db.execute(
      sql`SELECT product_id FROM product_channel WHERE channel_id = ${channelId} AND is_visible = true AND deleted_at IS NULL`,
    );
    return (res.rows as Array<Record<string, unknown>>).map((r) => String(r.product_id));
  }

  async priceSetIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (variantIds.length === 0) return map;
    const inClause = sql.join(variantIds.map((id) => sql`${id}`), sql`, `);
    const res = await this.db.execute(
      sql`SELECT variant_id, price_set_id FROM variant_price_set WHERE variant_id IN (${inClause}) AND deleted_at IS NULL`,
    );
    for (const row of res.rows as Array<Record<string, unknown>>) {
      map.set(String(row.variant_id), String(row.price_set_id));
    }
    return map;
  }

  async createProductType(name: string): Promise<ProductTypeDTO> {
    const rows = await this.db
      .insert(schema.productType)
      .values({ id: prefixedUlid("pt"), name })
      .returning();
    return { id: rows[0]!.id, name: rows[0]!.name };
  }

  async createAttribute(input: {
    name: string;
    handle: string;
    inputType: AttributeInputType;
    isFilterable?: boolean;
    isTranslatable?: boolean;
  }): Promise<AttributeDTO> {
    const rows = await this.db
      .insert(schema.attribute)
      .values({
        id: prefixedUlid("attr"),
        name: input.name,
        handle: input.handle,
        inputType: input.inputType,
        isFilterable: input.isFilterable ?? false,
        isTranslatable: input.isTranslatable ?? false,
      })
      .returning();
    const r = rows[0]!;
    return {
      id: r.id,
      name: r.name,
      handle: r.handle,
      input_type: r.inputType as AttributeInputType,
      is_filterable: r.isFilterable,
      is_translatable: r.isTranslatable,
    };
  }

  async createAttributeValue(input: {
    attributeId: string;
    value: string;
    label: string;
    sortOrder?: number;
  }): Promise<AttributeValueDTO> {
    const rows = await this.db
      .insert(schema.attributeValue)
      .values({
        id: prefixedUlid("attrv"),
        attributeId: input.attributeId,
        value: input.value,
        label: input.label,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    const r = rows[0]!;
    return { id: r.id, attribute_id: r.attributeId, value: r.value, label: r.label, sort_order: r.sortOrder };
  }
}

function toProductDTO(r: typeof schema.product.$inferSelect): ProductDTO {
  return {
    id: r.id,
    title: r.title,
    handle: r.handle,
    subtitle: r.subtitle ?? null,
    description: r.description ?? null,
    status: r.status as ProductStatus,
    thumbnail_file_id: r.thumbnailFileId ?? null,
    product_type_id: r.productTypeId ?? null,
    shipping_profile_id: r.shippingProfileId ?? null,
    free_shipping: r.freeShipping,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

function toVariantDTO(r: typeof schema.productVariant.$inferSelect): VariantDTO {
  return {
    id: r.id,
    product_id: r.productId,
    sku: r.sku,
    title: r.title,
    options: (r.options as Record<string, string>) ?? {},
    allow_backorder: r.allowBackorder,
    status: r.status as ProductStatus,
  };
}

function toImageDTO(r: typeof schema.productImage.$inferSelect): ImageDTO {
  return {
    id: r.id,
    product_id: r.productId,
    file_id: r.fileId,
    alt: r.alt ?? null,
    sort_order: r.sortOrder,
    is_primary: r.isPrimary,
  };
}

function toCategoryDTO(
  r: typeof schema.productCategory.$inferSelect,
  productCount: number,
): CategoryDTO {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    parent_id: r.parentId ?? null,
    sort_order: r.sortOrder,
    product_count: productCount,
  };
}
