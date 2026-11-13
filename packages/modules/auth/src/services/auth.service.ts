import {
  accountNotFound,
  emailAlreadyRegistered,
  emailNotConfigured,
  forbidden,
  invalidCredentials,
  invalidEmail,
  invalidPhone,
  invalidRegisterMode,
  invalidToken,
  invalidVerificationCode,
  phoneAlreadyRegistered,
  registerModeDisabled,
  smsNotConfigured,
  verificationCodeExpired,
  verificationTooFrequent,
  weakPassword,
} from "../errors.js";
import { randomInt, createHash } from "node:crypto";
import { changeAdminPassword, changeCustomerPassword } from "./change-password.js";
import { checkPasswordStrength } from "./password-policy.js";
import { revokeIdentitySessions } from "./session-revoke.js";
import { prefixedUlid } from "@mall/core";
import { signJwt, verifyJwt } from "./jwt.js";
import { hashToken, randomToken } from "./tokens.js";
import type {
  AuthConfig,
  AuthContext,
  AuthIdentityDTO,
  AuthRepository,
  AuthScope,
  AuthSettingsDTO,
  CustomerPort,
  EmailPort,
  IAuthModuleService,
  PasswordHasher,
  RegisterInput,
  RegisterMode,
  ResetPasswordInput,
  SmsPort,
  VerificationChannel,
  VerificationPurpose,
  TokenBlacklist,
  TokenPair,
} from "../types.js";

export interface AuthServiceDeps {
  repo: AuthRepository;
  hasher: PasswordHasher;
  customer: CustomerPort;
  config: AuthConfig;
  blacklist?: TokenBlacklist;
  /** 短信通道；未配置时发码直接报错，不静默放行。 */
  sms?: SmsPort;
  /** 邮件通道（复用通知模块 SMTP）；未配置时发邮件码直接报错。 */
  email?: EmailPort;
}

/** 验证码策略：5 分钟有效、60 秒冷却、每天 10 条、错 5 次作废。 */
const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const CODE_DAILY_LIMIT = 10;
const CODE_MAX_ATTEMPTS = 5;

const DEFAULT_SETTINGS: AuthSettingsDTO = { register_mode: "email" };

/** 报错文案用的中文名（服务端拒绝时要说人话）。 */
const MODE_LABEL: Record<RegisterMode, string> = {
  email: "邮箱注册",
  phone: "手机号注册",
};

/** 中国大陆手机号（淘宝/京东口径）；不合法直接拒绝，避免脏号码进库。 */
function normalizePhone(input: string): string {
  const phone = input.replace(/[\s-]/g, "");
  if (!/^1[3-9]\d{9}$/.test(phone)) throw invalidPhone(input);
  return phone;
}

/** 邮箱统一小写：否则 A@b.com 与 a@b.com 会变成两个账号（验证码按 target 查也是同理）。 */
function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalidEmail(input);
  return email;
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
/** 验证码哈希：绑目标（手机号/邮箱）+ 用途 + 服务端密钥，库被拖走也推不出明文码。 */
function hashVerificationCode(
  target: string,
  purpose: string,
  code: string,
  secret: string,
): string {
  return createHash("sha256").update(`${target}:${purpose}:${code}:${secret}`).digest("hex");
}

export class AuthService implements IAuthModuleService {
  private readonly inflight = new Map<string, Promise<TokenPair>>();

  constructor(private readonly deps: AuthServiceDeps) {}

  // —— 顾客账号设置 ——

  async getSettings(): Promise<AuthSettingsDTO> {
    return (await this.deps.repo.getSettings()) ?? DEFAULT_SETTINGS;
  }

  async updateSettings(patch: Partial<AuthSettingsDTO>): Promise<AuthSettingsDTO> {
    if (patch.register_mode !== undefined && !["email", "phone"].includes(patch.register_mode)) {
      throw invalidRegisterMode();
    }
    return this.deps.repo.upsertSettings(patch);
  }

  /**
   * 邮箱注册（ADR-025）：邮箱 + 密码 + 手机号（必填）+ 验证码。
   *
   * 验证码可以发到邮箱，也可以发到手机 —— 顾客自己选哪条通道能收到。
   * 手机号必须真实存在且验证通过：它是后续「手机号 + 验证码登录」的主体，
   * 不是选填资料。
   */
  async register(input: RegisterInput): Promise<{ identityId: string; customerId: string }> {
    const settings = await this.getSettings();
    // 服务端守：店铺关掉邮箱注册后，绕过前端直接打接口也必须被拒
    if (settings.register_mode !== "email") throw registerModeDisabled(MODE_LABEL.email);

    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);

    // 查重先于验码：不消耗顾客的验证码就能告诉他换个邮箱/手机号
    if (await this.deps.repo.findIdentityByEmail(email, "customer")) {
      throw emailAlreadyRegistered(email);
    }
    if (await this.deps.repo.findIdentityByPhone(phone)) throw phoneAlreadyRegistered(phone);

    const target = input.channel === "email" ? email : phone;
    await this.verifyCode(target, "register", input.code);

    const customer = await this.deps.customer.createCustomer({
      email,
      phone,
      firstName: input.profile?.firstName,
      lastName: input.profile?.lastName,
    });
    const identity = await this.deps.repo.insertIdentity({
      email,
      phone,
      phoneVerified: true,
      scope: "customer",
      customerId: customer.customerId,
    });
    const passwordHash = await this.deps.hasher.hash(input.password);
    await this.deps.repo.insertCredential(identity.id, passwordHash);
    return { identityId: identity.id, customerId: customer.customerId };
  }

  async login(input: { identifier: string; password: string }): Promise<TokenPair> {
    return this.authenticate(input.identifier, input.password, "customer");
  }

  /**
   * 发验证码（短信 / 邮件两条通道）。
   *
   * 限频两层：60 秒冷却（防连点）+ 每目标每天 10 条（防被打成短信轰炸机）。
   * 验证码只存哈希；开发环境可回传 devCode 便于自测，生产必须关闭。
   *
   * 通道未配置时先报错、再落码：否则「发不出去」的码会占掉 60 秒冷却。
   */
  async sendVerificationCode(input: {
    channel: VerificationChannel;
    target: string;
    purpose: VerificationPurpose;
  }): Promise<{ sent: boolean; devCode?: string }> {
    const target =
      input.channel === "email" ? normalizeEmail(input.target) : normalizePhone(input.target);

    if (input.channel === "email") {
      if (!this.deps.email) throw emailNotConfigured();
    } else if (!this.deps.sms) {
      throw smsNotConfigured();
    }

    const cooldown = await this.deps.repo.countVerificationCodesSince(
      target,
      input.purpose,
      new Date(Date.now() - CODE_COOLDOWN_MS),
    );
    if (cooldown > 0) throw verificationTooFrequent("发送太频繁，请 60 秒后再试");

    const daily = await this.deps.repo.countVerificationCodesSince(
      target,
      input.purpose,
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    if (daily >= CODE_DAILY_LIMIT) {
      throw verificationTooFrequent("今日获取次数过多，请明天再试");
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.deps.repo.insertVerificationCode({
      id: prefixedUlid("vcode"),
      channel: input.channel,
      target,
      purpose: input.purpose,
      codeHash: hashVerificationCode(target, input.purpose, code, this.deps.config.jwtSecret),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });

    if (input.channel === "email") {
      await this.deps.email!.send({ email: target, code, purpose: input.purpose });
    } else {
      await this.deps.sms!.send({ phone: target, code, purpose: input.purpose });
    }
    return {
      sent: true,
      ...(this.deps.config.exposeDevCode ? { devCode: code } : {}),
    };
  }

  /**
   * 手机号 + 验证码登录（淘宝：注册即登录）。
   *
   * 手机号不存在时自动建客户与身份：顾客不需要先「注册」再「登录」两步，
   * 这是手机号体系成熟做法；邮箱体系才需要独立的注册流程。
   */
  async loginWithPhoneCode(input: { phone: string; code: string }): Promise<TokenPair> {
    const phone = normalizePhone(input.phone);
    await this.verifyCode(phone, "login", input.code);

    let identity = await this.deps.repo.findIdentityByPhone(phone);
    if (!identity) {
      const settings = await this.getSettings();
      // 店铺只开放邮箱注册时，验证码不能变成「绕过注册方式」的后门
      if (settings.register_mode !== "phone") throw registerModeDisabled(MODE_LABEL.phone);
      const customer = await this.deps.customer.createCustomer({ phone });
      identity = await this.deps.repo.insertIdentity({
        phone,
        phoneVerified: true,
        scope: "customer",
        customerId: customer.customerId,
      });
    }
    if (identity.status !== "active") throw invalidCredentials();
    return this.toTokenPair(await this.issuePair(identity, "customer", NO_CLAIMS));
  }

  /**
   * 忘记密码第一步：发重置验证码。
   *
   * 通道跟着账号类型走 —— 输邮箱就发邮件、输手机号就发短信。
   * 不让顾客再选一次通道：他填的是哪个账号，码就该发到哪个地址。
   */
  async requestPasswordReset(input: { identifier: string }): Promise<{
    sent: boolean;
    channel: VerificationChannel;
    devCode?: string;
  }> {
    const { channel, target } = await this.resolveCustomerAccount(input.identifier);
    const res = await this.sendVerificationCode({ channel, target, purpose: "reset" });
    return { ...res, channel };
  }

  /**
   * 忘记密码第二步：验证码 + 新密码。
   *
   * 手机号注册的顾客从来没有密码，这条路同时就是「首次设置密码」——
   * 所以 credential 不存在时是**插入**而不是报错（淘宝同样允许短信重设即设密码）。
   *
   * 顺序不能换：先验码（一次性消费）再改密，码不对时一个字都不该落库；
   * 改密前撤销全部会话，密码变了旧登录必须立刻失效。
   */
  async resetPassword(input: ResetPasswordInput): Promise<{ revokedRefreshTokens: number }> {
    const { identity, target } = await this.resolveCustomerAccount(input.identifier);
    if (identity.status !== "active") throw invalidCredentials();

    const strength = checkPasswordStrength(input.newPassword);
    if (!strength.ok) throw weakPassword(strength.reason ?? "新口令强度不足");

    await this.verifyCode(target, "reset", input.code);

    const revoked = await revokeIdentitySessions(
      {
        repo: this.deps.repo,
        blacklist: this.deps.blacklist,
        refreshTtl: (scope) => this.refreshTtl(scope),
      },
      identity.id,
    );

    const newHash = await this.deps.hasher.hash(input.newPassword);
    const existing = await this.deps.repo.findCredentialHash(identity.id);
    if (existing) await this.deps.repo.updateCredentialHash(identity.id, newHash);
    else await this.deps.repo.insertCredential(identity.id, newHash);

    return { revokedRefreshTokens: revoked };
  }

  /** 按账号形态（邮箱 / 手机号）找顾客身份，并给出验证码该发到哪。 */
  private async resolveCustomerAccount(
    identifier: string,
  ): Promise<{ identity: AuthIdentityDTO; channel: VerificationChannel; target: string }> {
    const raw = identifier.trim();
    if (raw.includes("@")) {
      const email = normalizeEmail(raw);
      const identity = await this.deps.repo.findIdentityByEmail(email, "customer");
      if (!identity) throw accountNotFound(raw);
      return { identity, channel: "email", target: email };
    }
    const phone = normalizePhone(raw);
    const identity = await this.deps.repo.findIdentityByPhone(phone);
    if (!identity) throw accountNotFound(raw);
    return { identity, channel: "sms", target: phone };
  }

  /** 校验并消费验证码：错一次记一次，超限作废，成功后不可复用。 */
  private async verifyCode(
    target: string,
    purpose: VerificationPurpose,
    code: string,
  ): Promise<void> {
    const row = await this.deps.repo.findLatestVerificationCode(target, purpose);
    if (!row) throw invalidVerificationCode();
    if (new Date(row.expires_at).getTime() <= Date.now()) throw verificationCodeExpired();
    if (row.attempts >= CODE_MAX_ATTEMPTS) throw invalidVerificationCode();

    const expected = hashVerificationCode(target, purpose, code, this.deps.config.jwtSecret);
    if (row.code_hash !== expected) {
      await this.deps.repo.incrementVerificationAttempts(row.id);
      throw invalidVerificationCode();
    }
    // 条件消费：并发两次提交同一验证码时只有一次能成功
    const consumed = await this.deps.repo.consumeVerificationCode(row.id);
    if (!consumed) throw invalidVerificationCode();
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
    const payload = verifyJwt<{
      sub: string;
      scope: AuthScope;
      roles?: string[];
      permissions?: string[] | "all";
      customer_id?: string | null;
    }>(token, this.deps.config.jwtSecret);
    if (!payload) throw invalidToken();
    return {
      sub: payload.sub,
      scope: payload.scope,
      customerId: payload.customer_id ?? null,
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
  async changeCustomerPassword(input: {
    identityId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ revokedRefreshTokens: number }> {
    return changeCustomerPassword(
      {
        repo: this.deps.repo,
        hasher: this.deps.hasher,
        blacklist: this.deps.blacklist,
        refreshTtl: (scope) => this.refreshTtl(scope),
      },
      input,
    );
  }

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

  /**
   * 密码登录。
   *
   * identifier 先按邮箱查（兼容管理员的 "admin" 这种非邮箱登录名），
   * 查不到且是顾客时再按手机号查 —— 顾客可以用手机号 + 密码登录。
   */
  private async authenticate(
    identifier: string,
    password: string,
    scope: AuthScope,
  ): Promise<TokenPair> {
    let identity = await this.deps.repo.findIdentityByEmail(identifier, scope);
    if (!identity && scope === "customer") {
      identity = await this.deps.repo.findIdentityByPhone(identifier);
    }
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
      {
        sub: identity.id,
        scope,
        roles: extra.roles,
        permissions: extra.permissions,
        // 顾客身份才有：订单归属、地址簿都用它，别让下游拿 sub 去猜
        customer_id: identity.customer_id,
      },
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
