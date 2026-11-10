import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  AttributeDTO,
  AttributeInputType,
  AttributeValueDTO,
  CreateImageInput,
  CreateProductInput,
  CreateVariantInput,
  ImageDTO,
  ProductDTO,
  ProductQuery,
  ProductRepository,
  ProductStatus,
  ProductTypeDTO,
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
