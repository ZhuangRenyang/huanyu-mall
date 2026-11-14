import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  /** 店铺名称（店头、发货单页眉都用它）。 */
  storeName: text("store_name").notNull().default("全球商城"),
  /** 客服电话（发货单与页脚展示，可为空）。 */
  supportPhone: text("support_phone"),
  /** 店铺公告：店面顶部公告条（ADR-047），空值不显示。 */
  announcement: text("announcement"),
  /** 退货收件地址：顾客退货时照着寄回（ADR-053）。 */
  returnAddress: text("return_address"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 微页面（ADR-082）：slug + 纯文本正文，空行分段。 */
export const themeMicroPage = pgTable("theme_micro_page", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  isPublished: boolean("is_published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** 首页轮播图（ADR-080）：装修的第二块能力，图片走 file 模块。 */
export const themeBanner = pgTable("theme_banner", {
  id: text("id").primaryKey(),
  imageFileId: text("image_file_id").notNull(),
  link: text("link"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
