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
  /** 领取后 N 天有效（ADR-085）；空 = 只用 starts_at/ends_at 固定窗口。 */
  validDays: integer("valid_days"),
  /** 阶梯满减（ADR-086）：[{min_spent_minor, discount_minor}]；空 = 单档。 */
  tiers: jsonb("tiers"),
  /** 适用范围模式（ADR-092）：include = 指定可用；exclude = 指定不可用。 */
  scopeMode: text("scope_mode").notNull().default("include"),
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
    /** 领取时按 valid_days 算出的到期时间（ADR-085）；空 = 跟随券的 ends_at。 */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
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

/** 推广员（ADR-101）：顾客身份 + 推广码 + 佣金比例。 */
export const affiliate = pgTable(
  "affiliate",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    /** 推广码（大写字母数字）。 */
    code: text("code").notNull(),
    /** 佣金比例（万分比）：500 = 5%。 */
    commissionBps: integer("commission_bps").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_affiliate_customer").on(t.customerId),
    uniqueIndex("uq_affiliate_code").on(t.code),
  ],
);

/**
 * 佣金流水（ADR-101）。
 *
 * pending（待结算）→ settled（商家线下打款后标记）/ canceled（退款作废）。
 * 系统不自动打款：这里只是账本。
 */
export const affiliateCommission = pgTable(
  "affiliate_commission",
  {
    id: text("id").primaryKey(),
    affiliateId: text("affiliate_id").notNull(),
    orderId: text("order_id").notNull(),
    /** 基数快照（下单时实付）。 */
    orderTotalMinor: bigint("order_total_minor", { mode: "bigint" }).notNull(),
    commissionMinor: bigint("commission_minor", { mode: "bigint" }).notNull(),
    status: text("status").notNull().default("pending"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    canceledReason: text("canceled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_commission_order").on(t.orderId),
    index("idx_commission_affiliate").on(t.affiliateId, t.status),
  ],
);

/** 拼团活动（ADR-100）：参团免费、成团领券。 */
export const groupBuy = pgTable(
  "group_buy",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** 活动只针对一个规格：一个活动一个价，规则才解释得清。 */
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    /** 商品/规格快照。 */
    title: text("title").notNull(),
    originalPriceMinor: bigint("original_price_minor", { mode: "bigint" }).notNull(),
    groupPriceMinor: bigint("group_price_minor", { mode: "bigint" }).notNull(),
    /** 成团人数（含团长）。 */
    teamSize: integer("team_size").notNull(),
    status: text("status").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** 成团后发放的专享券（自动创建，is_public = false）。 */
    voucherId: text("voucher_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_group_buy_window").on(t.status, t.startsAt, t.endsAt)],
);

/** 拼团团（ADR-100）。 */
export const groupBuyTeam = pgTable(
  "group_buy_team",
  {
    id: text("id").primaryKey(),
    groupBuyId: text("group_buy_id").notNull(),
    leaderCustomerId: text("leader_customer_id").notNull(),
    /** forming = 等人；success = 已成团；expired = 到期未满。 */
    status: text("status").notNull().default("forming"),
    /** 已参团人数：条件 UPDATE 加减，防并发超员。 */
    memberCount: integer("member_count").notNull().default(0),
    /** 成团人数快照：活动后来改人数，已开的团仍按当时规则走。 */
    teamSize: integer("team_size").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_group_team_activity").on(t.groupBuyId, t.status)],
);

/** 拼团成员（ADR-100）。 */
export const groupBuyMember = pgTable(
  "group_buy_member",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    customerId: text("customer_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_group_member_team_customer").on(t.teamId, t.customerId),
    index("idx_group_member_customer").on(t.customerId),
  ],
);

/** 限时秒杀活动（ADR-099）。 */
export const flashSale = pgTable(
  "flash_sale",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** draft = 草稿；active = 进行中；ended = 已结束。 */
    status: text("status").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_flash_sale_window").on(t.status, t.startsAt, t.endsAt)],
);

/**
 * 秒杀活动商品（ADR-099）。
 *
 * 活动库存（stock/sold）是**营销限量**，与仓库库存是两道独立的闸。
 * sold 的扣减必须走条件 UPDATE（sold + n <= stock），DB 再加 CHECK 兜底。
 */
export const flashSaleItem = pgTable(
  "flash_sale_item",
  {
    id: text("id").primaryKey(),
    flashSaleId: text("flash_sale_id").notNull(),
    variantId: text("variant_id").notNull(),
    /** 商品/规格快照：商品改名或下架后仍可读。 */
    title: text("title").notNull(),
    originalPriceMinor: bigint("original_price_minor", { mode: "bigint" }).notNull(),
    flashPriceMinor: bigint("flash_price_minor", { mode: "bigint" }).notNull(),
    stock: integer("stock").notNull(),
    sold: integer("sold").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_flash_item_variant").on(t.flashSaleId, t.variantId),
    index("idx_flash_item_sale").on(t.flashSaleId),
  ],
);

/** 积分余额（ADR-093）：顾客维度，整数点数。 */
export const pointBalance = pgTable(
  "point_balance",
  {
    customerId: text("customer_id").primaryKey(),
    balance: bigint("balance", { mode: "bigint" }).notNull().default(0n),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("chk_point_balance_nonneg", sql`${t.balance} >= 0`)],
);

/** 积分流水（ADR-093）：正=增加，负=减少；balance_after 可回溯。 */
export const pointLedger = pgTable(
  "point_ledger",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    kind: text("kind").notNull(), // 'earn' | 'spend' | 'refund' | 'adjust'
    delta: bigint("delta", { mode: "bigint" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
    orderId: text("order_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_point_ledger_customer").on(t.customerId, t.createdAt),
    uniqueIndex("uq_point_ledger_earn_order")
      .on(t.orderId)
      .where(sql`${t.kind} = 'earn' AND ${t.orderId} IS NOT NULL`),
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
