import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * M-promotion 二期「Promotion 三件套 + Gift Card」表定义（对齐 ADR-012）。
 * 金额一律 bigint minor unit；软删除统一 deleted_at（gift_card_event 为只追加流水，无 updated_at/deleted_at）。
 * 实际 DDL 以手写迁移 migrations/0001_init.sql 为唯一事实（含 partial unique index 与 CHECK 约束）。
 */

export const promotion = pgTable(
  "promotion",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // 自动促销码；is_automatic=false 时可为 null，UNIQUE 用 partial index 允许多个 null
    code: text("code"),
    type: text("type").notNull(), // 'catalogue' | 'order'
    status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'inactive'
    isAutomatic: boolean("is_automatic").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimit: integer("usage_limit"), // null=不限
    used: integer("used").notNull().default(0),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_promotion_code").on(t.code).where(sql`${t.code} IS NOT NULL`)],
);

/** 营销功能级开关（promotion / voucher / gift_card），默认全部关闭。 */
export const promotionFeature = pgTable("promotion_feature", {
  feature: text("feature").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promotionRule = pgTable(
  "promotion_rule",
  {
    id: text("id").primaryKey(),
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotion.id),
    predicate: jsonb("predicate").notNull().default({}), // 类型化 JSON predicate（见 types.PromotionPredicate）
    rewardType: text("reward_type").notNull(), // 'fixed' | 'percentage'
    // percentage 为万分比（basis points，如 2000 = 20%）；fixed 为金额 minor unit
    rewardValue: bigint("reward_value", { mode: "bigint" }).notNull(),
    allocation: text("allocation"), // 'each' | 'across' | 'once'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_promo_rule_promotion").on(t.promotionId)],
);

export const voucher = pgTable("voucher", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("entire_order"), // 'entire_order' | 'shipping' | 'specific_product'
  usageLimit: integer("usage_limit"), // null=不限
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  discountType: text("discount_type").notNull(), // 'fixed' | 'percentage'
  discountValue: bigint("discount_value", { mode: "bigint" }).notNull(), // percentage=bps，fixed=minor unit
  minSpent: bigint("min_spent", { mode: "bigint" }), // 最低消费额 minor unit
  status: text("status").notNull().default("active"), // 'active' | 'disabled'
  /** 是否在店面公开可领（店铺券）；false = 只能凭码使用（ADR-029）。 */
  isPublic: boolean("is_public").notNull().default(false),
  /** 每个顾客最多领几张。 */
  collectLimit: integer("collect_limit").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const voucherCode = pgTable(
  "voucher_code",
  {
    id: text("id").primaryKey(),
    voucherId: text("voucher_id")
      .notNull()
      .references(() => voucher.id),
    code: text("code").notNull(),
    used: integer("used").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_voucher_code_code").on(t.code),
    index("idx_voucher_code_voucher").on(t.voucherId),
  ],
);

/** 领取记录：谁在什么时候领了哪张券、换到哪条券码（ADR-029）。 */
export const voucherCollection = pgTable(
  "voucher_collection",
  {
    id: text("id").primaryKey(),
    voucherId: text("voucher_id")
      .notNull()
      .references(() => voucher.id),
    customerId: text("customer_id").notNull(),
    /** 领取时发出的券码：核销仍走 voucher_code，这条只负责「这张券归谁」。 */
    codeId: text("code_id")
      .notNull()
      .references(() => voucherCode.id),
    /** unused | used；过期不落库，由 voucher.ends_at 现算。 */
    status: text("status").notNull().default("unused"),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    orderId: text("order_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_voucher_collection_customer").on(t.customerId, t.status),
    index("idx_voucher_collection_voucher").on(t.voucherId, t.customerId),
  ],
);

/**
 * 优惠券适用范围（ADR-064）：券 × 商品/分类 的多对多。
 * 只有 type='specific_product' 的券会读它；其它类型忽略。
 */
export const voucherScope = pgTable(
  "voucher_scope",
  {
    id: text("id").primaryKey(),
    voucherId: text("voucher_id").notNull(),
    /** 'product' | 'category'。 */
    scopeType: text("scope_type").notNull(),
    /** 商品 id 或分类 id（不建外键，跨模块不钉死）。 */
    scopeId: text("scope_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_voucher_scope_voucher_type_id").on(t.voucherId, t.scopeType, t.scopeId),
    index("idx_voucher_scope_voucher").on(t.voucherId),
  ],
);

export const giftCard = pgTable(
  "gift_card",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    initialBalance: bigint("initial_balance", { mode: "bigint" }).notNull(),
    currentBalance: bigint("current_balance", { mode: "bigint" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    assignedTo: text("assigned_to"), // 限制指定 customer id，防套现
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_gift_card_code").on(t.code),
    check("chk_gift_card_balance_nonneg", sql`${t.currentBalance} >= 0`),
  ],
);

export const giftCardEvent = pgTable(
  "gift_card_event",
  {
    id: text("id").primaryKey(),
    giftCardId: text("gift_card_id")
      .notNull()
      .references(() => giftCard.id),
    type: text("type").notNull(), // 'issued' | 'used_in_order' | 'refunded_in_order' | 'balance_adjusted' | 'deactivated' | 'activated'
    amount: bigint("amount", { mode: "bigint" }).notNull(), // 变动金额，正=增加，负=减少
    orderId: text("order_id"),
    parameters: jsonb("parameters"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_gift_card_event_card").on(t.giftCardId)],
);
