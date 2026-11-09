import { bigint, boolean, char, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const paymentCollection = pgTable("payment_collection", {
  id: text("id").primaryKey(),
  cartId: text("cart_id"),
  orderId: text("order_id"),
  currencyCode: char("currency_code", { length: 3 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  status: text("status").notNull().default("not_paid"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const paymentSession = pgTable(
  "payment_session",
  {
    id: text("id").primaryKey(),
    paymentCollectionId: text("payment_collection_id").notNull().references(() => paymentCollection.id),
    providerId: text("provider_id").notNull(),
    status: text("status").notNull().default("pending"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    providerReference: text("provider_reference"),
    providerRaw: jsonb("provider_raw"),
    context: jsonb("context"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_paysess_collection").on(t.paymentCollectionId)],
);

export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    paymentCollectionId: text("payment_collection_id").notNull().references(() => paymentCollection.id),
    sessionId: text("session_id"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    status: text("status").notNull().default("pending"),
    providerId: text("provider_id").notNull(),
    providerReference: text("provider_reference"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("idx_pay_collection").on(t.paymentCollectionId)],
);

export const paymentTransaction = pgTable(
  "payment_transaction",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull().references(() => payment.id),
    type: text("type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    status: text("status").notNull().default("pending"),
    providerReference: text("provider_reference"),
    providerRaw: jsonb("provider_raw"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_paytxn_payment").on(t.paymentId),
    uniqueIndex("uq_paytxn_idem").on(t.idempotencyKey).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const refund = pgTable(
  "refund",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull().references(() => payment.id),
    orderId: text("order_id"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    providerReference: text("provider_reference"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_rfd_payment").on(t.paymentId),
    uniqueIndex("uq_refund_idem").on(t.idempotencyKey).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const paymentProviderConfig = pgTable(
  "payment_provider_config",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    label: text("label").notNull(),
    capabilities: jsonb("capabilities"),
    optionsEncrypted: text("options_encrypted"),
    isEnabled: boolean("is_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_ppc_identifier").on(t.identifier).where(sql`${t.deletedAt} IS NULL`)],
);

export const providerWebhookEvent = pgTable(
  "provider_webhook_event",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    raw: jsonb("raw"),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: jsonb("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_pwebhook_event").on(t.providerId, t.eventId)],
);
