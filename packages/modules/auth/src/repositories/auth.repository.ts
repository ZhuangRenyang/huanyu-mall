import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  AdminUserDTO,
  AuthIdentityDTO,
  AuthRepository,
  AuthScope,
  AuthSettingsDTO,
  IdentityStatus,
  RbacRoleDTO,
  RefreshTokenDTO,
  RegisterMode,
  VerificationCodeRow,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

const SETTINGS_ID = "auth_default";
const DEFAULT_SETTINGS: AuthSettingsDTO = { register_mode: "email" };

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: Db) {}

  // ---- 设置 ----

  async getSettings(): Promise<AuthSettingsDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.authSettings)
      .where(eq(schema.authSettings.id, SETTINGS_ID))
      .limit(1);
    const row = rows[0];
    return row ? { register_mode: row.registerMode as RegisterMode } : null;
  }

  async upsertSettings(patch: Partial<AuthSettingsDTO>): Promise<AuthSettingsDTO> {
    const current = (await this.getSettings()) ?? DEFAULT_SETTINGS;
    const values = {
      id: SETTINGS_ID,
      registerMode: patch.register_mode ?? current.register_mode,
      updatedAt: new Date(),
    };
    const rows = await this.db
      .insert(schema.authSettings)
      .values(values)
      .onConflictDoUpdate({ target: schema.authSettings.id, set: values })
      .returning();
    return { register_mode: rows[0]!.registerMode as RegisterMode };
  }

  async findIdentityByEmail(email: string, scope: AuthScope): Promise<AuthIdentityDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.authIdentity)
      .where(and(eq(schema.authIdentity.email, email), eq(schema.authIdentity.scope, scope), isNull(schema.authIdentity.deletedAt)))
      .limit(1);
    return rows[0] ? toIdentityDTO(rows[0]) : null;
  }

  async findIdentityById(id: string): Promise<AuthIdentityDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.authIdentity)
      .where(and(eq(schema.authIdentity.id, id), isNull(schema.authIdentity.deletedAt)))
      .limit(1);
    return rows[0] ? toIdentityDTO(rows[0]) : null;
  }

  async insertIdentity(input: {
    email?: string | null;
    phone?: string | null;
    phoneVerified?: boolean;
    scope: AuthScope;
    customerId?: string | null;
    adminUserId?: string | null;
  }): Promise<AuthIdentityDTO> {
    const rows = await this.db
      .insert(schema.authIdentity)
      .values({
        id: prefixedUlid("aid"),
        email: input.email ?? null,
        phone: input.phone ?? null,
        phoneVerifiedAt: input.phoneVerified ? new Date() : null,
        scope: input.scope,
        customerId: input.customerId ?? null,
        adminUserId: input.adminUserId ?? null,
      })
      .returning();
    return toIdentityDTO(rows[0]!);
  }

  async findIdentityByPhone(phone: string): Promise<AuthIdentityDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.authIdentity)
      .where(
        and(
          eq(schema.authIdentity.phone, phone),
          eq(schema.authIdentity.scope, "customer"),
          isNull(schema.authIdentity.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toIdentityDTO(rows[0]) : null;
  }

  async bindPhone(identityId: string, phone: string): Promise<void> {
    await this.db
      .update(schema.authIdentity)
      .set({ phone, phoneVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.authIdentity.id, identityId));
  }

  // ---- 验证码 ----

  async insertVerificationCode(input: {
    id: string;
    channel: string;
    target: string;
    purpose: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(schema.verificationCode).values({
      id: input.id,
      channel: input.channel,
      target: input.target,
      purpose: input.purpose,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
    });
  }

  async findLatestVerificationCode(
    target: string,
    purpose: string,
  ): Promise<VerificationCodeRow | null> {
    const rows = await this.db
      .select()
      .from(schema.verificationCode)
      .where(
        and(
          eq(schema.verificationCode.target, target),
          eq(schema.verificationCode.purpose, purpose),
          isNull(schema.verificationCode.consumedAt),
        ),
      )
      .orderBy(desc(schema.verificationCode.createdAt))
      .limit(1);
    return rows[0] ? toVerificationRow(rows[0]) : null;
  }

  async consumeVerificationCode(id: string): Promise<boolean> {
    // 条件更新：并发下只有一次能抢到，避免同一验证码被用两次
    const rows = await this.db
      .update(schema.verificationCode)
      .set({ consumedAt: new Date() })
      .where(
        and(eq(schema.verificationCode.id, id), isNull(schema.verificationCode.consumedAt)),
      )
      .returning({ id: schema.verificationCode.id });
    return rows.length > 0;
  }

  async incrementVerificationAttempts(id: string): Promise<number> {
    const rows = await this.db
      .update(schema.verificationCode)
      .set({ attempts: sql`(${schema.verificationCode.attempts}::int + 1)::text` })
      .where(eq(schema.verificationCode.id, id))
      .returning({ attempts: schema.verificationCode.attempts });
    return Number(rows[0]?.attempts ?? 0);
  }

  async countVerificationCodesSince(
    target: string,
    purpose: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.verificationCode)
      .where(
        and(
          eq(schema.verificationCode.target, target),
          eq(schema.verificationCode.purpose, purpose),
          gte(schema.verificationCode.createdAt, since),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async insertCredential(identityId: string, passwordHash: string): Promise<void> {
    await this.db.insert(schema.authCredential).values({
      id: prefixedUlid("acrd"),
      authIdentityId: identityId,
      passwordHash,
    });
  }

  async findCredentialHash(identityId: string): Promise<string | null> {
    const rows = await this.db
      .select({ passwordHash: schema.authCredential.passwordHash })
      .from(schema.authCredential)
      .where(eq(schema.authCredential.authIdentityId, identityId))
      .limit(1);
    return rows[0]?.passwordHash ?? null;
  }

  async updateCredentialHash(identityId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(schema.authCredential)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(schema.authCredential.authIdentityId, identityId));
  }

  async insertAdminUser(input: { email: string; name?: string | null }): Promise<AdminUserDTO> {
    const rows = await this.db
      .insert(schema.adminUser)
      .values({ id: prefixedUlid("adm"), email: input.email, name: input.name ?? null })
      .returning();
    return toAdminDTO(rows[0]!);
  }

  async findAdminUserById(id: string): Promise<AdminUserDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.adminUser)
      .where(and(eq(schema.adminUser.id, id), isNull(schema.adminUser.deletedAt)))
      .limit(1);
    return rows[0] ? toAdminDTO(rows[0]) : null;
  }

  async findRolesByAdminUserId(adminUserId: string): Promise<RbacRoleDTO[]> {
    const rows = await this.db
      .select({ role: schema.rbacRole })
      .from(schema.rbacUserRole)
      .innerJoin(schema.rbacRole, eq(schema.rbacRole.id, schema.rbacUserRole.rbacRoleId))
      .where(and(eq(schema.rbacUserRole.adminUserId, adminUserId), isNull(schema.rbacRole.deletedAt)));
    return rows.map((r) => toRoleDTO(r.role));
  }

  async upsertRole(input: { name: string; permissions: string[] | "all" }): Promise<RbacRoleDTO> {
    const existing = await this.db
      .select()
      .from(schema.rbacRole)
      .where(and(eq(schema.rbacRole.name, input.name), isNull(schema.rbacRole.deletedAt)))
      .limit(1);
    if (existing[0]) return toRoleDTO(existing[0]);
    const rows = await this.db
      .insert(schema.rbacRole)
      .values({ id: prefixedUlid("role"), name: input.name, permissions: input.permissions })
      .returning();
    return toRoleDTO(rows[0]!);
  }

  async assignRole(adminUserId: string, roleId: string): Promise<void> {
    await this.db.insert(schema.rbacUserRole).values({
      id: prefixedUlid("ur"),
      adminUserId,
      rbacRoleId: roleId,
    });
  }

  async insertRefreshToken(input: {
    authIdentityId: string;
    tokenHash: string;
    scope: AuthScope;
    expiresAt: Date;
  }): Promise<RefreshTokenDTO> {
    const rows = await this.db
      .insert(schema.refreshToken)
      .values({
        id: prefixedUlid("rt"),
        authIdentityId: input.authIdentityId,
        tokenHash: input.tokenHash,
        scope: input.scope,
        expiresAt: input.expiresAt,
      })
      .returning();
    return toRefreshDTO(rows[0]!);
  }

  async findRefreshTokenByHash(hash: string): Promise<RefreshTokenDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.refreshToken)
      .where(eq(schema.refreshToken.tokenHash, hash))
      .limit(1);
    return rows[0] ? toRefreshDTO(rows[0]) : null;
  }

  async revokeRefreshToken(id: string, replacedBy: string | null): Promise<void> {
    await this.db
      .update(schema.refreshToken)
      .set({ revokedAt: new Date(), replacedBy, updatedAt: new Date() })
      .where(eq(schema.refreshToken.id, id));
  }

  async revokeRefreshTokensByIdentity(identityId: string): Promise<RefreshTokenDTO[]> {
    const rows = await this.db
      .update(schema.refreshToken)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.refreshToken.authIdentityId, identityId), isNull(schema.refreshToken.revokedAt)))
      .returning();
    return rows.map(toRefreshDTO);
  }
}

function toIdentityDTO(r: typeof schema.authIdentity.$inferSelect): AuthIdentityDTO {
  return {
    id: r.id,
    email: r.email ?? null,
    phone: r.phone ?? null,
    scope: r.scope as AuthScope,
    customer_id: r.customerId ?? null,
    admin_user_id: r.adminUserId ?? null,
    status: r.status as IdentityStatus,
  };
}

function toVerificationRow(
  r: typeof schema.verificationCode.$inferSelect,
): VerificationCodeRow {
  return {
    id: r.id,
    channel: r.channel,
    target: r.target,
    purpose: r.purpose,
    code_hash: r.codeHash,
    expires_at: r.expiresAt.toISOString(),
    attempts: Number(r.attempts),
    consumed_at: r.consumedAt ? r.consumedAt.toISOString() : null,
    created_at: r.createdAt.toISOString(),
  };
}

function toAdminDTO(r: typeof schema.adminUser.$inferSelect): AdminUserDTO {
  return { id: r.id, email: r.email, name: r.name ?? null, status: r.status as IdentityStatus };
}

function toRoleDTO(r: typeof schema.rbacRole.$inferSelect): RbacRoleDTO {
  const perms = r.permissions;
  return { id: r.id, name: r.name, permissions: perms === "all" ? "all" : (perms as string[]) };
}

function toRefreshDTO(r: typeof schema.refreshToken.$inferSelect): RefreshTokenDTO {
  return {
    id: r.id,
    auth_identity_id: r.authIdentityId,
    token_hash: r.tokenHash,
    scope: r.scope as AuthScope,
    expires_at: r.expiresAt.toISOString(),
    revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
    replaced_by: r.replacedBy ?? null,
  };
}
