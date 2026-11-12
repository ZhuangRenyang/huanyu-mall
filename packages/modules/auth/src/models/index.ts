import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const authIdentity = pgTable(
  "auth_identity",
  {
    id: text("id").primaryKey(),
    /** 手机号注册的顾客没有邮箱：email 可空，两者至少有一个（DB CHECK 兜底）。 */
    email: text("email"),
    /** 顾客登录主体（淘宝以手机号为主）；管理端不用这个字段。 */
    phone: text("phone"),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    scope: text("scope").notNull().default("customer"),
    customerId: text("customer_id"),
    adminUserId: text("admin_user_id"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_auth_identity_email").on(t.email).where(sql`${t.deletedAt} IS NULL`),
    // 一个手机号只能对应一个登录身份：否则「手机号登录」会查出两个账号
    uniqueIndex("uq_auth_identity_phone").on(t.phone).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const authCredential = pgTable("auth_credential", {
  id: text("id").primaryKey(),
  authIdentityId: text("auth_identity_id").notNull().unique().references(() => authIdentity.id),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 顾客账号设置（注册方式等店铺级策略，ADR-025）。单行表，id 固定 auth_default。 */
export const authSettings = pgTable("auth_settings", {
  id: text("id").primaryKey(),
  /** email | phone */
  registerMode: text("register_mode").notNull().default("email"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 短信/邮箱验证码：只存哈希，一次性消费。 */
export const verificationCode = pgTable(
  "verification_code",
  {
    id: text("id").primaryKey(),
    /** sms | email */
    channel: text("channel").notNull(),
    /** 手机号或邮箱 */
    target: text("target").notNull(),
    /** login | register | reset */
    purpose: text("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: text("attempts").notNull().default("0"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_verification_target").on(t.target, t.purpose, t.createdAt)],
);

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
