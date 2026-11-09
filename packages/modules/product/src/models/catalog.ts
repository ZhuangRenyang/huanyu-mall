import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** M01 商品目录主表（search_vector 生成列见迁移 SQL，模型不参与查询故省略类型）。 */
export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    subtitle: text("subtitle"),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    thumbnailFileId: text("thumbnail_file_id"),
    productTypeId: text("product_type_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_product_handle").on(t.handle).where(sql`${t.deletedAt} IS NULL`),
    index("idx_product_status").on(t.status),
  ],
);

export const productVariant = pgTable(
  "product_variant",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => product.id),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    options: jsonb("options").notNull(),
    barcode: text("barcode"),
    ean: text("ean"),
    weightGram: integer("weight_gram"),
    heightMm: integer("height_mm"),
    widthMm: integer("width_mm"),
    lengthMm: integer("length_mm"),
    allowBackorder: boolean("allow_backorder").notNull().default(false),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_variant_sku").on(t.sku).where(sql`${t.deletedAt} IS NULL`),
    index("idx_variant_product").on(t.productId),
  ],
);

export const productImage = pgTable(
  "product_image",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => product.id),
    fileId: text("file_id").notNull(),
    alt: text("alt"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_pimg_product").on(t.productId)],
);

export const productCategory = pgTable(
  "product_category",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    parentId: text("parent_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_cat_handle").on(t.handle).where(sql`${t.deletedAt} IS NULL`),
    index("idx_cat_parent").on(t.parentId),
  ],
);

export const productCategoryLink = pgTable(
  "product_category_link",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => product.id),
    categoryId: text("category_id").notNull().references(() => productCategory.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_pcat").on(t.productId, t.categoryId)],
);
