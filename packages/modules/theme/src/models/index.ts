import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** M17 Theme：设计变量单一事实来源（单例表，一行）+ 版本留痕。 */
export const themeSettings = pgTable("theme_settings", {
  id: text("id").primaryKey(),
  primaryColor: text("primary_color").notNull(),
  gradientColor: text("gradient_color").notNull(),
  accentColor: text("accent_color").notNull(),
  fontFamily: text("font_family").notNull(),
  borderRadius: text("border_radius").notNull(),
  shadow: text("shadow").notNull(),
  logoFileId: text("logo_file_id"),
  productImageRatio: text("product_image_ratio").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const themeRevision = pgTable(
  "theme_revision",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    settings: jsonb("settings").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_theme_revision_version").on(t.version)],
);
