/** M11 Auth 类型与契约（对齐架构 §2.1 / ADR-007）。 */

export type AuthScope = "customer" | "admin";
export type IdentityStatus = "active" | "disabled";

export interface AuthIdentityDTO {
  id: string;
  /** 手机号注册的顾客没有邮箱。 */
  email: string | null;
  /** 顾客登录主体（手机号注册才有）。 */
  phone: string | null;
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
  /** identity id（登录主体）。订单归属用的是 customerId，不是这个。 */
  sub: string;
  scope: AuthScope;
  /**
   * 顾客 id（顾客登录才有）。
   *
   * sub 是 identity id，和 order.customer_id 不是一回事 —— 之前拿 sub 比 customer_id，
   * 已登录顾客查自己的订单也会被判 403。订单归属一律用这个字段。
   */
  customerId: string | null;
  roles: string[];
  permissions: string[] | "all";
}

export interface AuthConfig {
  jwtSecret: string;
  accessTtlSec: number;
  customerRefreshTtlSec: number;
  adminRefreshTtlSec: number;
  /**
   * 开发环境把验证码回传给前端（便于自测）。
   * 生产必须为 false —— 否则任何人请求发码就能拿到验证码，等于没有验证。
   */
  exposeDevCode?: boolean;
}

export interface RegisterInput {
  email: string;
  password: string;
  /**
   * 注册必须绑手机号（ADR-025）：
   * 短信验证时它是验证目标，邮箱验证时它是顾客联系方式（后续可用手机号登录）。
   */
  phone: string;
  /** 验证码发到哪：邮箱还是手机。两种都支持，顾客自己选。 */
  channel: VerificationChannel;
  code: string;
  profile?: { firstName?: string; lastName?: string };
}

/** 顾客注册方式（店铺级设置）。 */
export type RegisterMode = "email" | "phone";

export interface AuthSettingsDTO {
  /**
   * email：邮箱 + 密码注册（Shopify 路线，独立站常用）；
   * phone：手机号 + 验证码，注册即登录（淘宝路线）。
   */
  register_mode: RegisterMode;
}

/** 验证码用途：注册即登录 / 验证码登录 / 重置密码。 */
export type VerificationPurpose = "register" | "login" | "reset";
export type VerificationChannel = "sms" | "email";

/** 验证码表行（仅模块内部使用，不对外暴露）。 */
export interface VerificationCodeRow {
  id: string;
  channel: string;
  target: string;
  purpose: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
  created_at: string;
}

export interface AuthRepository {
  // ---- 设置 ----
  getSettings(): Promise<AuthSettingsDTO | null>;
  upsertSettings(patch: Partial<AuthSettingsDTO>): Promise<AuthSettingsDTO>;

  findIdentityByEmail(email: string, scope: AuthScope): Promise<AuthIdentityDTO | null>;
  /** 按手机号找登录身份（顾客登录主体）。 */
  findIdentityByPhone(phone: string): Promise<AuthIdentityDTO | null>;
  findIdentityById(id: string): Promise<AuthIdentityDTO | null>;
  insertIdentity(input: {
    email?: string | null;
    phone?: string | null;
    phoneVerified?: boolean;
    scope: AuthScope;
    customerId?: string | null;
    adminUserId?: string | null;
  }): Promise<AuthIdentityDTO>;
  /** 给已有身份绑定手机号（邮箱注册后补绑；手机号全局唯一）。 */
  bindPhone(identityId: string, phone: string): Promise<void>;

  // ---- 验证码 ----
  insertVerificationCode(input: {
    id: string;
    channel: string;
    target: string;
    purpose: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<void>;
  /** 最近一条未消费的验证码（同 target + purpose）。 */
  findLatestVerificationCode(target: string, purpose: string): Promise<VerificationCodeRow | null>;
  /** 消费（置 consumed_at）；返回是否成功抢到（防并发重复使用）。 */
  consumeVerificationCode(id: string): Promise<boolean>;
  /** 失败次数 +1，返回新值。 */
  incrementVerificationAttempts(id: string): Promise<number>;
  /** 统计时间窗口内发过多少条（限频用）。 */
  countVerificationCodesSince(target: string, purpose: string, since: Date): Promise<number>;
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
    /** 手机号注册的顾客没有邮箱。 */
    email?: string | null;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }): Promise<{ customerId: string }>;
}

/**
 * 短信通道端口（外部 IO）。
 *
 * 生产接阿里云/腾讯云短信；开发用 console 实现把验证码写日志。
 * 没有配置通道时**不能静默通过** —— 否则等于任何人知道手机号就能登录。
 */
export interface SmsPort {
  send(input: { phone: string; code: string; purpose: VerificationPurpose }): Promise<void>;
}

/**
 * 邮件通道端口（外部 IO），复用通知模块的 SMTP 配置。
 *
 * 和短信同一原则：没配 SMTP 就明确报错，不静默放行。
 * 开发环境由 API 层降级成日志（配合 exposeDevCode），生产必须真发。
 */
export interface EmailPort {
  send(input: { email: string; code: string; purpose: VerificationPurpose }): Promise<void>;
}

/** 撤销黑名单端口（生产 Redis 毫秒级；DB revoked_at 为主事实）。 */
export interface TokenBlacklist {
  revoke(id: string, ttlSec: number): Promise<void>;
  isRevoked(id: string): Promise<boolean>;
}

export interface IAuthModuleService {
  // —— 顾客账号设置（注册方式） ——
  getSettings(): Promise<AuthSettingsDTO>;
  updateSettings(patch: Partial<AuthSettingsDTO>): Promise<AuthSettingsDTO>;

  /**
   * 邮箱注册：邮箱 + 密码 + 手机号（必填）+ 验证码。
   * 验证码发邮箱或发手机都行，由 `channel` 指定 —— 顾客自己选哪条通道。
   */
  register(input: RegisterInput): Promise<{ identityId: string; customerId: string }>;
  /** 密码登录：identifier 可以是邮箱，也可以是手机号。 */
  login(input: { identifier: string; password: string }): Promise<TokenPair>;
  /** 发验证码（短信或邮件）。返回是否已发送；开发环境带 devCode 方便自测。 */
  sendVerificationCode(input: {
    channel: VerificationChannel;
    target: string;
    purpose: VerificationPurpose;
  }): Promise<{ sent: boolean; devCode?: string }>;
  /**
   * 手机号 + 验证码登录（淘宝：注册即登录）。
   *
   * 手机号不存在时自动建客户与身份 —— 顾客不需要先「注册」再「登录」两步。
   */
  loginWithPhoneCode(input: { phone: string; code: string }): Promise<TokenPair>;
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
