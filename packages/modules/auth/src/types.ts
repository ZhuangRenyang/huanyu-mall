/** M11 Auth 类型与契约（对齐架构 §2.1 / ADR-007）。 */

export type AuthScope = "customer" | "admin";
export type IdentityStatus = "active" | "disabled";

export interface AuthIdentityDTO {
  id: string;
  email: string;
  scope: AuthScope;
  customer_id: string | null;
  admin_user_id: string | null;
  status: IdentityStatus;
}

export interface AdminUserDTO {
  id: string;
  email: string;
  name: string | null;
  status: IdentityStatus;
}

export interface RbacRoleDTO {
  id: string;
  name: string;
  permissions: string[] | "all";
}

export interface RefreshTokenDTO {
  id: string;
  auth_identity_id: string;
  token_hash: string;
  scope: AuthScope;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  identityId: string;
  scope: AuthScope;
}

/** JWT 解出的访问上下文；permissions 在登录时从 rbac_role 载入并嵌入（access 无状态）。 */
export interface AuthContext {
  sub: string;
  scope: AuthScope;
  roles: string[];
  permissions: string[] | "all";
}

export interface AuthConfig {
  jwtSecret: string;
  accessTtlSec: number;
  customerRefreshTtlSec: number;
  adminRefreshTtlSec: number;
}

export interface RegisterInput {
  email: string;
  password: string;
  profile?: { firstName?: string; lastName?: string; phone?: string };
}

export interface AuthRepository {
  findIdentityByEmail(email: string, scope: AuthScope): Promise<AuthIdentityDTO | null>;
  findIdentityById(id: string): Promise<AuthIdentityDTO | null>;
  insertIdentity(input: {
    email: string;
    scope: AuthScope;
    customerId?: string | null;
    adminUserId?: string | null;
  }): Promise<AuthIdentityDTO>;
  insertCredential(identityId: string, passwordHash: string): Promise<void>;
  findCredentialHash(identityId: string): Promise<string | null>;
  /** 覆盖该 identity 的口令哈希（改密用；一个 identity 只有一条 credential）。 */
  updateCredentialHash(identityId: string, passwordHash: string): Promise<void>;
  insertAdminUser(input: { email: string; name?: string | null }): Promise<AdminUserDTO>;
  findAdminUserById(id: string): Promise<AdminUserDTO | null>;
  findRolesByAdminUserId(adminUserId: string): Promise<RbacRoleDTO[]>;
  upsertRole(input: { name: string; permissions: string[] | "all" }): Promise<RbacRoleDTO>;
  assignRole(adminUserId: string, roleId: string): Promise<void>;
  insertRefreshToken(input: {
    authIdentityId: string;
    tokenHash: string;
    scope: AuthScope;
    expiresAt: Date;
  }): Promise<RefreshTokenDTO>;
  findRefreshTokenByHash(hash: string): Promise<RefreshTokenDTO | null>;
  revokeRefreshToken(id: string, replacedBy: string | null): Promise<void>;
  /** 撤销该 identity 下所有未撤销的 refresh_token，返回被撤销的记录（供黑名单同步）。 */
  revokeRefreshTokensByIdentity(identityId: string): Promise<RefreshTokenDTO[]>;
}

/** 密码哈希端口（argon2id）。 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hashed: string, password: string): Promise<boolean>;
}

/** 注册时经端口调 Customer 建档案（M11 不存客户业务数据）。 */
export interface CustomerPort {
  createCustomer(input: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }): Promise<{ customerId: string }>;
}

/** 撤销黑名单端口（生产 Redis 毫秒级；DB revoked_at 为主事实）。 */
export interface TokenBlacklist {
  revoke(id: string, ttlSec: number): Promise<void>;
  isRevoked(id: string): Promise<boolean>;
}

export interface IAuthModuleService {
  register(input: RegisterInput): Promise<{ identityId: string; customerId: string }>;
  login(input: { email: string; password: string }): Promise<TokenPair>;
  adminLogin(input: { email: string; password: string }): Promise<TokenPair>;
  refresh(refreshToken: string): Promise<TokenPair>;
  logout(refreshToken: string): Promise<void>;
  verifyAccessToken(token: string): Promise<AuthContext>;
  assertPermission(ctx: AuthContext, permission: string): void;
  seedRoles(): Promise<void>;
  createAdminUser(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<{ adminUserId: string }>;
  /**
   * 管理员自助改密：校验当前口令 → 强度校验 → 撤销该管理员全部 refresh_token → 覆盖口令哈希。
   * 改密后不签发新 token，调用方需引导用户重新登录。
   */
  changeAdminPassword(input: {
    identityId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ revokedRefreshTokens: number }>;
}
