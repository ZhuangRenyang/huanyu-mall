import { bigint, char, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const priceSet = pgTable("price_set", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const priceList = pgTable("price_list", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("manual"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const price = pgTable(
  "price",
  {
    id: text("id").primaryKey(),
    priceSetId: text("price_set_id").notNull().references(() => priceSet.id),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    compareAtAmountMinor: bigint("compare_at_amount_minor", { mode: "bigint" }),
    priceListId: text("price_list_id"),
    minQuantity: integer("min_quantity").notNull().default(1),
    maxQuantity: integer("max_quantity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_price")
      .on(t.priceSetId, t.currencyCode, t.priceListId, t.minQuantity)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_price_set").on(t.priceSetId),
  ],
);

export const priceListRule = pgTable(
  "price_list_rule",
  {
    id: text("id").primaryKey(),
    priceListId: text("price_list_id").notNull().references(() => priceList.id),
    ruleType: text("rule_type").notNull(),
    ruleValue: text("rule_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_plr_list").on(t.priceListId)],
);
