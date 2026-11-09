import { boolean, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { channel } from "./channel.js";

export const channelLocale = pgTable(
  "channel_locale",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull().references(() => channel.id),
    locale: text("locale").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_channel_locale").on(t.channelId, t.locale)],
);
