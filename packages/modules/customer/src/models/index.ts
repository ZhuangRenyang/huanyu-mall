import { bigint, boolean, char, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const customer = pgTable(
  "customer",
  {
    id: text("id").primaryKey(),
    /** 手机号注册的顾客没有邮箱。 */
    email: text("email"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_customer_email").on(t.email).where(sql`${t.deletedAt} IS NULL`)],
);

export const customerAddress = pgTable(
  "customer_address",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull().references(() => customer.id),
    firstName: text("first_name").notNull(),
    // 中国地址不拆姓/名（ADR-026）：last_name 可空
    lastName: text("last_name"),
    phone: text("phone"),
    line1: text("line1").notNull(),
    line2: text("line2"),
    // 「省市区」整串存 province；city / postal_code 对中文地址常为空
    city: text("city"),
    province: text("province"),
    postalCode: text("postal_code"),
    countryCode: char("country_code", { length: 2 }).notNull(),
    isDefaultShipping: boolean("is_default_shipping").notNull().default(false),
    isDefaultBilling: boolean("is_default_billing").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_addr_customer").on(t.customerId)],
);

export const customerGroup = pgTable("customer_group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** 商品收藏（ADR-048）：取消即删行，不做软删。 */
export const customerFavorite = pgTable(
  "customer_favorite",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    productId: text("product_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_customer_favorite").on(t.customerId, t.productId),
    index("idx_customer_favorite_customer").on(t.customerId, t.createdAt),
  ],
);

/** 会员等级（ADR-102）：按累计消费自动匹配，只决定「折扣力度」。 */
export const memberLevel = pgTable(
  "member_level",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** 达到该累计消费（minor）即为这一档。 */
    thresholdMinor: bigint("threshold_minor", { mode: "bigint" }).notNull().default(0n),
    /** 折扣力度（万分比）：500 = 便宜 5%。 */
    discountBps: integer("discount_bps").notNull(),
    /** 展示排序（等级从低到高）。 */
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_member_level_threshold").on(t.thresholdMinor)],
);
