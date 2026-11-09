import { char, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { region } from "./region.js";

export const regionCountry = pgTable(
  "region_country",
  {
    id: text("id").primaryKey(),
    regionId: text("region_id").notNull().references(() => region.id),
    countryCode: char("country_code", { length: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_region_country").on(t.regionId, t.countryCode)],
);
