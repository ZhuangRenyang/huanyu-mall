import type {
  AdminUserDTO,
  AuthIdentityDTO,
  AuthRepository,
  AuthScope,
  AuthSettingsDTO,
  CustomerPort,
  RbacRoleDTO,
  RefreshTokenDTO,
  TokenBlacklist,
  VerificationCodeRow,
} from "../../src/types.js";

/** 内存版 AuthRepository：覆盖 credential 更新与按 identity 批量撤销 refresh_token。 */
export class InMemoryAuthRepository implements AuthRepository {
  readonly identities = new Map<string, AuthIdentityDTO>();
  readonly credentials = new Map<string, string>();
  readonly adminUsers = new Map<string, AdminUserDTO>();
  readonly roles = new Map<string, RbacRoleDTO>();
  readonly userRoles: Array<{ adminUserId: string; roleId: string }> = [];
  readonly refreshTokens = new Map<string, RefreshTokenDTO>();
  /** 验证码：按插入顺序存，校验时取最新一条。 */
  readonly codes: VerificationCodeRow[] = [];
  /** 店铺级设置：内存里就是一条，null 表示从未写过（走默认值）。 */
  settings: AuthSettingsDTO | null = null;
  private counter = 0;

  async getSettings(): Promise<AuthSettingsDTO | null> {
    return this.settings;
  }

  async upsertSettings(patch: Partial<AuthSettingsDTO>): Promise<AuthSettingsDTO> {
    const current = this.settings ?? { register_mode: "email" };
    this.settings = { register_mode: patch.register_mode ?? current.register_mode };
    return this.settings;
  }

  async findIdentityByEmail(email: string, scope: AuthScope): Promise<AuthIdentityDTO | null> {
    return [...this.identities.values()].find((i) => i.email === email && i.scope === scope) ?? null;
  }
  async findIdentityById(id: string): Promise<AuthIdentityDTO | null> {
    return this.identities.get(id) ?? null;
  }
  async insertIdentity(input: {
    email?: string | null;
    phone?: string | null;
    phoneVerified?: boolean;
    scope: AuthScope;
    customerId?: string | null;
    adminUserId?: string | null;
  }): Promise<AuthIdentityDTO> {
    const dto: AuthIdentityDTO = {
      id: `aid_${++this.counter}`,
      email: input.email ?? null,
      phone: input.phone ?? null,
      scope: input.scope,
      customer_id: input.customerId ?? null,
      admin_user_id: input.adminUserId ?? null,
      status: "active",
    };
    this.identities.set(dto.id, dto);
    return dto;
  }

  async findIdentityByPhone(phone: string): Promise<AuthIdentityDTO | null> {
    return (
      [...this.identities.values()].find(
        (i) => i.phone === phone && i.scope === "customer",
      ) ?? null
    );
  }

  async bindPhone(identityId: string, phone: string): Promise<void> {
    const identity = this.identities.get(identityId);
    if (identity) identity.phone = phone;
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
    this.codes.push({
      id: input.id,
      channel: input.channel,
      target: input.target,
      purpose: input.purpose,
      code_hash: input.codeHash,
      expires_at: input.expiresAt.toISOString(),
      attempts: 0,
      consumed_at: null,
      created_at: new Date().toISOString(),
    });
  }

  async findLatestVerificationCode(
    target: string,
    purpose: string,
  ): Promise<VerificationCodeRow | null> {
    const rows = this.codes
      .filter((c) => c.target === target && c.purpose === purpose && !c.consumed_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows[0] ?? null;
  }

  async consumeVerificationCode(id: string): Promise<boolean> {
    const row = this.codes.find((c) => c.id === id);
    if (!row || row.consumed_at) return false;
    row.consumed_at = new Date().toISOString();
    return true;
  }

  async incrementVerificationAttempts(id: string): Promise<number> {
    const row = this.codes.find((c) => c.id === id);
    if (!row) return 0;
    row.attempts += 1;
    return row.attempts;
  }

  async countVerificationCodesSince(
    target: string,
    purpose: string,
    since: Date,
  ): Promise<number> {
    const from = since.getTime();
    return this.codes.filter(
      (c) =>
        c.target === target &&
        c.purpose === purpose &&
        new Date(c.created_at).getTime() >= from,
    ).length;
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
  /** 测试用：把已发出的验证码时间往前挪，模拟 60 秒冷却期已过。 */
  rewindCodeCooldown(ms = 61_000): void {
    const past = new Date(Date.now() - ms).toISOString();
    for (const c of this.codes) c.created_at = past;
  }

  roleByName(name: string): RbacRoleDTO | null {
    return [...this.roles.values()].find((r) => r.name === name) ?? null;
  }
}

/** 顾客端口替身：记住建过谁，测试才能断言「手机号确实落进了客户档案」。 */
export class FakeCustomerPort implements CustomerPort {
  readonly created: Array<{
    email?: string | null;
    phone?: string;
    firstName?: string;
    lastName?: string;
  }> = [];
  private counter = 0;
  async createCustomer(input: {
    email?: string | null;
    phone?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<{ customerId: string }> {
    this.created.push(input);
    return { customerId: `cust_${++this.counter}` };
  }
}

/** 短信/邮件通道替身：把发出去的码留在内存里，测试可以断言通道选对了。 */
export class FakeSmsPort {
  readonly sent: Array<{ phone: string; code: string; purpose: string }> = [];
  async send(input: { phone: string; code: string; purpose: string }): Promise<void> {
    this.sent.push(input);
  }
}

export class FakeEmailPort {
  readonly sent: Array<{ email: string; code: string; purpose: string }> = [];
  async send(input: { email: string; code: string; purpose: string }): Promise<void> {
    this.sent.push(input);
  }
}

/** 把「最后发出的验证码」当明文取出来用（生产里只有哈希，测试里换到明文更直观）。 */
export function lastCodeOf(
  port: FakeSmsPort | FakeEmailPort | undefined,
): string {
  const last = port?.sent.at(-1);
  if (!last) throw new Error("没有发出任何验证码");
  return last.code;
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
