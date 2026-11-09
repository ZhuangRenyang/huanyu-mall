import { boolean, integer, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { productVariant } from "./catalog.js";

export const productType = pgTable("product_type", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const attribute = pgTable(
  "attribute",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    inputType: text("input_type").notNull(),
    isFilterable: boolean("is_filterable").notNull().default(false),
    isTranslatable: boolean("is_translatable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_attribute_handle").on(t.handle).where(sql`${t.deletedAt} IS NULL`)],
);

export const productTypeAttribute = pgTable(
  "product_type_attribute",
  {
    id: text("id").primaryKey(),
    productTypeId: text("product_type_id").notNull().references(() => productType.id),
    attributeId: text("attribute_id").notNull().references(() => attribute.id),
    sortOrder: integer("sort_order").notNull().default(0),
    isVariantAttribute: boolean("is_variant_attribute").notNull().default(false),
    isRequired: boolean("is_required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_ptype_attr")
      .on(t.productTypeId, t.attributeId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const attributeValue = pgTable(
  "attribute_value",
  {
    id: text("id").primaryKey(),
    attributeId: text("attribute_id").notNull().references(() => attribute.id),
    value: text("value").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_attr_value")
      .on(t.attributeId, t.value)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const variantAttributeValue = pgTable(
  "variant_attribute_value",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull().references(() => productVariant.id),
    attributeId: text("attribute_id").notNull().references(() => attribute.id),
    attributeValueId: text("attribute_value_id").notNull().references(() => attributeValue.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_vav").on(t.variantId, t.attributeId), index("idx_vav_variant").on(t.variantId)],
);
