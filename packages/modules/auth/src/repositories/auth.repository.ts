import { and, eq, isNull } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  AdminUserDTO,
  AuthIdentityDTO,
  AuthRepository,
  AuthScope,
  IdentityStatus,
  RbacRoleDTO,
  RefreshTokenDTO,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: Db) {}

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
    email: string;
    scope: AuthScope;
    customerId?: string | null;
    adminUserId?: string | null;
  }): Promise<AuthIdentityDTO> {
    const rows = await this.db
      .insert(schema.authIdentity)
      .values({
        id: prefixedUlid("aid"),
        email: input.email,
        scope: input.scope,
        customerId: input.customerId ?? null,
        adminUserId: input.adminUserId ?? null,
      })
      .returning();
    return toIdentityDTO(rows[0]!);
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
    email: r.email,
    scope: r.scope as AuthScope,
    customer_id: r.customerId ?? null,
    admin_user_id: r.adminUserId ?? null,
    status: r.status as IdentityStatus,
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
