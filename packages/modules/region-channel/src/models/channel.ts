import { sql } from "drizzle-orm";
import { boolean, char, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { region } from "./region.js";

export const channel = pgTable(
  "channel",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    regionId: text("region_id").notNull().references(() => region.id),
    defaultLocale: text("default_locale").notNull().default("zh-CN"),
    marketScope: text("market_scope").notNull().default("cn"),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_channel_slug").on(t.slug).where(sql`${t.deletedAt} IS NULL`)],
);
