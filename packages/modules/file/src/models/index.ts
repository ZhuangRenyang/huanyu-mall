import { bigint, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const file = pgTable(
  "file",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    storageProvider: text("storage_provider").notNull().default("local"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_file_key").on(t.key).where(sql`${t.deletedAt} IS NULL`)],
);

export const fileVariant = pgTable(
  "file_variant",
  {
    id: text("id").primaryKey(),
    fileId: text("file_id").notNull().references(() => file.id),
    variant: text("variant").notNull(),
    key: text("key").notNull(),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_file_variant").on(t.fileId, t.variant),
    uniqueIndex("uq_file_variant_key").on(t.key).where(sql`${t.deletedAt} IS NULL`),
  ],
);
