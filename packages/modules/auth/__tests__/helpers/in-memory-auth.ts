import type {
  AdminUserDTO,
  AuthIdentityDTO,
  AuthRepository,
  AuthScope,
  CustomerPort,
  RbacRoleDTO,
  RefreshTokenDTO,
  TokenBlacklist,
} from "../../src/types.js";

/** 内存版 AuthRepository：覆盖 credential 更新与按 identity 批量撤销 refresh_token。 */
export class InMemoryAuthRepository implements AuthRepository {
  readonly identities = new Map<string, AuthIdentityDTO>();
  readonly credentials = new Map<string, string>();
  readonly adminUsers = new Map<string, AdminUserDTO>();
  readonly roles = new Map<string, RbacRoleDTO>();
  readonly userRoles: Array<{ adminUserId: string; roleId: string }> = [];
  readonly refreshTokens = new Map<string, RefreshTokenDTO>();
  private counter = 0;

  async findIdentityByEmail(email: string, scope: AuthScope): Promise<AuthIdentityDTO | null> {
    return [...this.identities.values()].find((i) => i.email === email && i.scope === scope) ?? null;
  }
  async findIdentityById(id: string): Promise<AuthIdentityDTO | null> {
    return this.identities.get(id) ?? null;
  }
  async insertIdentity(input: {
    email: string;
    scope: AuthScope;
    customerId?: string | null;
    adminUserId?: string | null;
  }): Promise<AuthIdentityDTO> {
    const dto: AuthIdentityDTO = {
      id: `aid_${++this.counter}`,
      email: input.email,
      scope: input.scope,
      customer_id: input.customerId ?? null,
      admin_user_id: input.adminUserId ?? null,
      status: "active",
    };
    this.identities.set(dto.id, dto);
    return dto;
  }
  async insertCredential(identityId: string, passwordHash: string): Promise<void> {
    this.credentials.set(identityId, passwordHash);
  }
  async findCredentialHash(identityId: string): Promise<string | null> {
    return this.credentials.get(identityId) ?? null;
  }
  async updateCredentialHash(identityId: string, passwordHash: string): Promise<void> {
    this.credentials.set(identityId, passwordHash);
  }
  async insertAdminUser(input: { email: string; name?: string | null }): Promise<AdminUserDTO> {
    const dto: AdminUserDTO = {
      id: `adm_${++this.counter}`,
      email: input.email,
      name: input.name ?? null,
      status: "active",
    };
    this.adminUsers.set(dto.id, dto);
    return dto;
  }
  async findAdminUserById(id: string): Promise<AdminUserDTO | null> {
    return this.adminUsers.get(id) ?? null;
  }
  async findRolesByAdminUserId(adminUserId: string): Promise<RbacRoleDTO[]> {
    return this.userRoles
      .filter((ur) => ur.adminUserId === adminUserId)
      .map((ur) => this.roles.get(ur.roleId))
      .filter((r): r is RbacRoleDTO => r !== undefined);
  }
  async upsertRole(input: { name: string; permissions: string[] | "all" }): Promise<RbacRoleDTO> {
    const existing = this.roleByName(input.name);
    if (existing) return existing;
    const dto: RbacRoleDTO = { id: `role_${++this.counter}`, name: input.name, permissions: input.permissions };
    this.roles.set(dto.id, dto);
    return dto;
  }
  async assignRole(adminUserId: string, roleId: string): Promise<void> {
    this.userRoles.push({ adminUserId, roleId });
  }
  async insertRefreshToken(input: {
    authIdentityId: string;
    tokenHash: string;
    scope: AuthScope;
    expiresAt: Date;
  }): Promise<RefreshTokenDTO> {
    const dto: RefreshTokenDTO = {
      id: `rt_${++this.counter}`,
      auth_identity_id: input.authIdentityId,
      token_hash: input.tokenHash,
      scope: input.scope,
      expires_at: input.expiresAt.toISOString(),
      revoked_at: null,
      replaced_by: null,
    };
    this.refreshTokens.set(dto.id, dto);
    return dto;
  }
  async findRefreshTokenByHash(hash: string): Promise<RefreshTokenDTO | null> {
    return [...this.refreshTokens.values()].find((t) => t.token_hash === hash) ?? null;
  }
  async revokeRefreshToken(id: string, replacedBy: string | null): Promise<void> {
    const t = this.refreshTokens.get(id);
    if (t) {
      t.revoked_at = new Date().toISOString();
      t.replaced_by = replacedBy;
    }
  }
  async revokeRefreshTokensByIdentity(identityId: string): Promise<RefreshTokenDTO[]> {
    const revoked: RefreshTokenDTO[] = [];
    for (const token of this.refreshTokens.values()) {
      if (token.auth_identity_id === identityId && !token.revoked_at) {
        token.revoked_at = new Date().toISOString();
        revoked.push(token);
      }
    }
    return revoked;
  }
  roleByName(name: string): RbacRoleDTO | null {
    return [...this.roles.values()].find((r) => r.name === name) ?? null;
  }
}

export class FakeCustomerPort implements CustomerPort {
  private counter = 0;
  async createCustomer(): Promise<{ customerId: string }> {
    return { customerId: `cust_${++this.counter}` };
  }
}

export class InMemoryBlacklist implements TokenBlacklist {
  readonly revoked = new Set<string>();
  async revoke(id: string): Promise<void> {
    this.revoked.add(id);
  }
  async isRevoked(id: string): Promise<boolean> {
    return this.revoked.has(id);
  }
}

export const CONFIG = {
  jwtSecret: "test-secret",
  accessTtlSec: 900,
  customerRefreshTtlSec: 3600,
  adminRefreshTtlSec: 3600,
};
