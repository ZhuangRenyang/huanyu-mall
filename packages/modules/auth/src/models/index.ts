import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const authIdentity = pgTable(
  "auth_identity",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    scope: text("scope").notNull().default("customer"),
    customerId: text("customer_id"),
    adminUserId: text("admin_user_id"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_auth_identity_email").on(t.email).where(sql`${t.deletedAt} IS NULL`)],
);

export const authCredential = pgTable("auth_credential", {
  id: text("id").primaryKey(),
  authIdentityId: text("auth_identity_id").notNull().unique().references(() => authIdentity.id),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerIdentity = pgTable(
  "provider_identity",
  {
    id: text("id").primaryKey(),
    authIdentityId: text("auth_identity_id").notNull().references(() => authIdentity.id),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_provider_subject").on(t.provider, t.providerSubject)],
);

export const refreshToken = pgTable(
  "refresh_token",
  {
    id: text("id").primaryKey(),
    authIdentityId: text("auth_identity_id").notNull().references(() => authIdentity.id),
    tokenHash: text("token_hash").notNull(),
    scope: text("scope").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: text("replaced_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_refresh_token_hash").on(t.tokenHash),
    index("idx_rt_identity").on(t.authIdentityId),
  ],
);

export const adminUser = pgTable(
  "admin_user",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_admin_user_email").on(t.email).where(sql`${t.deletedAt} IS NULL`)],
);

export const rbacRole = pgTable(
  "rbac_role",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    permissions: jsonb("permissions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_rbac_role_name").on(t.name).where(sql`${t.deletedAt} IS NULL`)],
);

export const rbacUserRole = pgTable(
  "rbac_user_role",
  {
    id: text("id").primaryKey(),
    adminUserId: text("admin_user_id").notNull().references(() => adminUser.id),
    rbacRoleId: text("rbac_role_id").notNull().references(() => rbacRole.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_rbac_user_role").on(t.adminUserId, t.rbacRoleId)],
);
