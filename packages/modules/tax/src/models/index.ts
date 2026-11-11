import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** 店铺级税务策略单例行（ADR-018）：收不收税 / 税名 / 价格含不含税。 */
export const taxSettings = pgTable("tax_settings", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  taxName: text("tax_name").notNull().default("税"),
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taxRate = pgTable("tax_rate", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rateBps: integer("rate_bps").notNull(),
  isInclusive: boolean("is_inclusive").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const taxRateRule = pgTable(
  "tax_rate_rule",
  {
    id: text("id").primaryKey(),
    taxRateId: text("tax_rate_id").notNull().references(() => taxRate.id),
    ruleType: text("rule_type").notNull(),
    ruleValue: text("rule_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_taxr_rate").on(t.taxRateId)],
);
