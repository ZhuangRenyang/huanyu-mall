import { boolean, char, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const region = pgTable("region", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currencyCode: char("currency_code", { length: 3 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
