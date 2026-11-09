import {
  emailAlreadyRegistered,
  forbidden,
  invalidCredentials,
  invalidToken,
} from "../errors.js";
import { changeAdminPassword } from "./change-password.js";
import { signJwt, verifyJwt } from "./jwt.js";
import { hashToken, randomToken } from "./tokens.js";
import type {
  AuthConfig,
  AuthContext,
  AuthIdentityDTO,
  AuthRepository,
  AuthScope,
  CustomerPort,
  IAuthModuleService,
  PasswordHasher,
  RegisterInput,
  TokenBlacklist,
  TokenPair,
} from "../types.js";

export interface AuthServiceDeps {
  repo: AuthRepository;
  hasher: PasswordHasher;
  customer: CustomerPort;
  config: AuthConfig;
  blacklist?: TokenBlacklist;
}

interface IssuedPair extends TokenPair {
  refreshTokenId: string;
}

interface ExtraClaims {
  roles: string[];
  permissions: string[] | "all";
}

const NO_CLAIMS: ExtraClaims = { roles: [], permissions: [] };

/**
 * M11 对外门面。ADR-007：access JWT 15min 无状态；refresh 轮换 30d/7d + DB revoked_at +
 * Redis 黑名单端口；**refresh 单飞**（同 token 并发刷新只发一对新 token）。
 */
export class AuthService implements IAuthModuleService {
  private readonly inflight = new Map<string, Promise<TokenPair>>();

  constructor(private readonly deps: AuthServiceDeps) {}

  async register(input: RegisterInput): Promise<{ identityId: string; customerId: string }> {
    const existing = await this.deps.repo.findIdentityByEmail(input.email, "customer");
    if (existing) throw emailAlreadyRegistered(input.email);

    const customer = await this.deps.customer.createCustomer({
      email: input.email,
      firstName: input.profile?.firstName,
      lastName: input.profile?.lastName,
      phone: input.profile?.phone,
    });
    const identity = await this.deps.repo.insertIdentity({
      email: input.email,
      scope: "customer",
      customerId: customer.customerId,
    });
    const passwordHash = await this.deps.hasher.hash(input.password);
    await this.deps.repo.insertCredential(identity.id, passwordHash);
    return { identityId: identity.id, customerId: customer.customerId };
  }

  async login(input: { email: string; password: string }): Promise<TokenPair> {
    return this.authenticate(input.email, input.password, "customer");
  }

  async adminLogin(input: { email: string; password: string }): Promise<TokenPair> {
    return this.authenticate(input.email, input.password, "admin");
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const key = hashToken(refreshToken);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.doRefresh(refreshToken).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  async logout(refreshToken: string): Promise<void> {
    const row = await this.deps.repo.findRefreshTokenByHash(hashToken(refreshToken));
    if (row && !row.revoked_at) {
      await this.deps.repo.revokeRefreshToken(row.id, null);
      if (this.deps.blacklist) await this.deps.blacklist.revoke(row.id, this.refreshTtl(row.scope));
    }
  }

  async verifyAccessToken(token: string): Promise<AuthContext> {
    const payload = verifyJwt<{ sub: string; scope: AuthScope; roles?: string[]; permissions?: string[] | "all" }>(
      token,
      this.deps.config.jwtSecret,
    );
    if (!payload) throw invalidToken();
    return {
      sub: payload.sub,
      scope: payload.scope,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    };
  }

  assertPermission(ctx: AuthContext, permission: string): void {
    if (ctx.scope !== "admin") throw forbidden(permission);
    if (ctx.permissions === "all") return;
    if (Array.isArray(ctx.permissions) && ctx.permissions.includes(permission)) return;
    throw forbidden(permission);
  }

  async seedRoles(): Promise<void> {
    await this.deps.repo.upsertRole({ name: "admin", permissions: "all" });
    await this.deps.repo.upsertRole({
      name: "staff",
      permissions: ["products", "orders", "customers", "inventory", "files"],
    });
  }

  /** 创建初始管理员（install.sh 步骤 8）：admin_user + identity + credential + admin 角色。幂等：已存在则直接返回。 */
  async createAdminUser(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<{ adminUserId: string }> {
    const existing = await this.deps.repo.findIdentityByEmail(input.email, "admin");
    if (existing) {
      return { adminUserId: existing.admin_user_id ?? existing.id };
    }

    await this.seedRoles();
    const admin = await this.deps.repo.insertAdminUser({
      email: input.email,
      name: input.name ?? null,
    });
    const identity = await this.deps.repo.insertIdentity({
      email: input.email,
      scope: "admin",
      adminUserId: admin.id,
    });
    const passwordHash = await this.deps.hasher.hash(input.password);
    await this.deps.repo.insertCredential(identity.id, passwordHash);
    const adminRole = await this.deps.repo.upsertRole({
      name: "admin",
      permissions: "all",
    });
    await this.deps.repo.assignRole(admin.id, adminRole.id);
    return { adminUserId: admin.id };
  }

  /**
   * 管理员自助改密：校验当前口令 → 撤销该管理员全部 refresh_token → 覆盖口令哈希。
   * 改密后不签发新 token，调用方需引导用户重新登录。实现见 change-password.ts。
   */
  async changeAdminPassword(input: {
    identityId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ revokedRefreshTokens: number }> {
    return changeAdminPassword(
      {
        repo: this.deps.repo,
        hasher: this.deps.hasher,
        blacklist: this.deps.blacklist,
        refreshTtl: (scope) => this.refreshTtl(scope),
      },
      input,
    );
  }

  private async authenticate(email: string, password: string, scope: AuthScope): Promise<TokenPair> {
    const identity = await this.deps.repo.findIdentityByEmail(email, scope);
    if (!identity || identity.status !== "active") throw invalidCredentials();
    const hash = await this.deps.repo.findCredentialHash(identity.id);
    if (!hash || !(await this.deps.hasher.verify(hash, password))) throw invalidCredentials();
    const extra = scope === "admin" ? await this.resolvePermissions(identity.admin_user_id!) : NO_CLAIMS;
    return this.toTokenPair(await this.issuePair(identity, scope, extra));
  }

  private async doRefresh(refreshToken: string): Promise<TokenPair> {
    const row = await this.deps.repo.findRefreshTokenByHash(hashToken(refreshToken));
    if (!row || row.revoked_at) throw invalidToken();
    if (new Date(row.expires_at).getTime() <= Date.now()) throw invalidToken();
    if (this.deps.blacklist && (await this.deps.blacklist.isRevoked(row.id))) throw invalidToken();

    const identity = await this.deps.repo.findIdentityById(row.auth_identity_id);
    if (!identity || identity.status !== "active") throw invalidToken();

    const extra = row.scope === "admin" ? await this.resolvePermissions(identity.admin_user_id!) : NO_CLAIMS;
    const issued = await this.issuePair(identity, row.scope, extra);
    await this.deps.repo.revokeRefreshToken(row.id, issued.refreshTokenId);
    if (this.deps.blacklist) await this.deps.blacklist.revoke(row.id, this.refreshTtl(row.scope));
    return this.toTokenPair(issued);
  }

  private async resolvePermissions(adminUserId: string): Promise<ExtraClaims> {
    const roles = await this.deps.repo.findRolesByAdminUserId(adminUserId);
    const roleNames = roles.map((r) => r.name);
    if (roles.some((r) => r.permissions === "all")) return { roles: roleNames, permissions: "all" };
    const permissions = [...new Set(roles.flatMap((r) => (Array.isArray(r.permissions) ? r.permissions : [])))];
    return { roles: roleNames, permissions };
  }

  private async issuePair(identity: AuthIdentityDTO, scope: AuthScope, extra: ExtraClaims): Promise<IssuedPair> {
    const accessToken = signJwt(
      { sub: identity.id, scope, roles: extra.roles, permissions: extra.permissions },
      this.deps.config.jwtSecret,
      this.deps.config.accessTtlSec,
    );
    const refreshToken = randomToken();
    const row = await this.deps.repo.insertRefreshToken({
      authIdentityId: identity.id,
      tokenHash: hashToken(refreshToken),
      scope,
      expiresAt: new Date(Date.now() + this.refreshTtl(scope) * 1000),
    });
    return {
      accessToken,
      refreshToken,
      accessExpiresIn: this.deps.config.accessTtlSec,
      identityId: identity.id,
      scope,
      refreshTokenId: row.id,
    };
  }

  private refreshTtl(scope: AuthScope): number {
    return scope === "admin" ? this.deps.config.adminRefreshTtlSec : this.deps.config.customerRefreshTtlSec;
  }

  private toTokenPair(issued: IssuedPair): TokenPair {
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessExpiresIn: issued.accessExpiresIn,
      identityId: issued.identityId,
      scope: issued.scope,
    };
  }
}
