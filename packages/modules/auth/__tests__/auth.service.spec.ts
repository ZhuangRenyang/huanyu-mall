import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { AuthService } from "../src/services/auth.service.js";
import { Argon2PasswordHasher } from "../src/services/password.js";
import {
  CONFIG,
  FakeCustomerPort,
  FakeEmailPort,
  FakeSmsPort,
  InMemoryAuthRepository,
  InMemoryBlacklist,
  lastCodeOf,
} from "./helpers/in-memory-auth.js";

const PHONE = "13800001111";

function setup(settings?: { register_mode: "email" | "phone" }) {
  const repo = new InMemoryAuthRepository();
  if (settings) repo.settings = settings;
  const blacklist = new InMemoryBlacklist();
  const hasher = new Argon2PasswordHasher();
  const sms = new FakeSmsPort();
  const mailer = new FakeEmailPort();
  const customer = new FakeCustomerPort();
  const service = new AuthService({
    repo,
    hasher,
    customer,
    config: CONFIG,
    blacklist,
    sms,
    email: mailer,
  });
  return { repo, blacklist, hasher, service, sms, mailer, customer };
}

/** 走一遍「发码 → 取明文码」，邮箱注册用。 */
async function emailCodeFor(
  service: AuthService,
  mailer: FakeEmailPort,
  email: string,
): Promise<string> {
  await service.sendVerificationCode({ channel: "email", target: email, purpose: "register" });
  return lastCodeOf(mailer);
}

describe("AuthService（M11，JWT + refresh 轮换单飞 + RBAC）", () => {
  it("邮箱注册（邮箱验证码）→ 登录 → 校验 access token", async () => {
    const { service, mailer, customer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");

    const reg = await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });
    expect(reg.customerId).toMatch(/^cust_/);
    // 手机号必须落进客户档案：它是后续手机号登录的主体
    expect(customer.created.at(-1)).toMatchObject({ email: "a@b.com", phone: PHONE });

    const pair = await service.login({ identifier: "a@b.com", password: "pw123456" });
    expect(pair.accessToken.split(".")).toHaveLength(3);
    const ctx = await service.verifyAccessToken(pair.accessToken);
    expect(ctx.scope).toBe("customer");
    expect(ctx.sub).toBe(reg.identityId);
    expect(ctx.customerId).toBe(reg.customerId);
  });

  it("邮箱注册后可以用手机号 + 密码登录（同一身份两条入口）", async () => {
    const { service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");
    await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });

    const pair = await service.login({ identifier: PHONE, password: "pw123456" });
    await expect(service.verifyAccessToken(pair.accessToken)).resolves.toMatchObject({
      scope: "customer",
    });
  });

  it("手机号验证码也能完成邮箱注册（两条验证通道等价）", async () => {
    const { service, sms } = setup();
    await service.sendVerificationCode({ channel: "sms", target: PHONE, purpose: "register" });
    const code = lastCodeOf(sms);

    const reg = await service.register({
      email: "c@d.com",
      password: "pw123456",
      phone: PHONE,
      channel: "sms",
      code,
    });
    expect(reg.identityId).toMatch(/^aid_/);
  });

  it("注册必须带手机号：空号或格式不对直接拒绝", async () => {
    const { service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");

    await expect(
      service.register({
        email: "a@b.com",
        password: "pw123456",
        phone: "",
        channel: "email",
        code,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("验证码错/复用被拒（一次一码）", async () => {
    const { service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");

    await expect(
      service.register({
        email: "a@b.com",
        password: "pw123456",
        phone: PHONE,
        channel: "email",
        code: "000000",
      }),
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      service.register({
        email: "a@b.com",
        password: "pw123456",
        phone: PHONE,
        channel: "email",
        code,
      }),
    ).resolves.toMatchObject({ identityId: expect.stringMatching(/^aid_/) });
  });

  it("后台切到手机号注册后，邮箱注册接口被拒（服务端守，不靠界面隐藏）", async () => {
    const { service, mailer } = setup({ register_mode: "phone" });
    const code = await emailCodeFor(service, mailer, "a@b.com");

    await expect(
      service.register({
        email: "a@b.com",
        password: "pw123456",
        phone: PHONE,
        channel: "email",
        code,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("手机号验证码登录：新号自动注册，旧号直接登录", async () => {
    const { repo, service, sms, customer } = setup({ register_mode: "phone" });

    await service.sendVerificationCode({ channel: "sms", target: PHONE, purpose: "login" });
    const first = await service.loginWithPhoneCode({ phone: PHONE, code: lastCodeOf(sms) });
    expect(first.scope).toBe("customer");
    expect(customer.created).toHaveLength(1);

    repo.rewindCodeCooldown();
    await service.sendVerificationCode({ channel: "sms", target: PHONE, purpose: "login" });
    const second = await service.loginWithPhoneCode({ phone: PHONE, code: lastCodeOf(sms) });
    // 第二次不该再建客户 —— 只是登录
    expect(customer.created).toHaveLength(1);
    expect(second.identityId).toBe(first.identityId);
  });

  it("邮箱注册模式下，陌生手机号不能用验证码「绕过」注册方式", async () => {
    const { service, sms } = setup();
    await service.sendVerificationCode({ channel: "sms", target: PHONE, purpose: "login" });

    await expect(
      service.loginWithPhoneCode({ phone: PHONE, code: lastCodeOf(sms) }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("发码 60 秒冷却：连发第二次被拒", async () => {
    const { service, sms } = setup();
    await service.sendVerificationCode({ channel: "sms", target: PHONE, purpose: "login" });
    expect(sms.sent).toHaveLength(1);

    await expect(
      service.sendVerificationCode({ channel: "sms", target: PHONE, purpose: "login" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("refresh 轮换：旧 token 立即失效", async () => {
    const { service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");
    await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });
    const pair = await service.login({ identifier: "a@b.com", password: "pw123456" });

    const next = await service.refresh(pair.refreshToken);
    expect(next.refreshToken).not.toBe(pair.refreshToken);
    await expect(service.refresh(pair.refreshToken)).rejects.toBeInstanceOf(DomainError);
    await expect(service.verifyAccessToken(next.accessToken)).resolves.toMatchObject({ scope: "customer" });
  });

  it("并发刷新只发一次新 token（单飞）", async () => {
    const { repo, service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");
    await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });
    const pair = await service.login({ identifier: "a@b.com", password: "pw123456" });

    const [r1, r2] = await Promise.all([
      service.refresh(pair.refreshToken),
      service.refresh(pair.refreshToken),
    ]);
    expect(r1.refreshToken).toBe(r2.refreshToken);
    const rows = [...repo.refreshTokens.values()].filter((t) => t.auth_identity_id === pair.identityId);
    expect(rows).toHaveLength(2); // 登录 token（已撤销）+ 1 个新 token
  });

  it("登出后 refresh 失效（黑名单/撤销生效）", async () => {
    const { blacklist, service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");
    await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });
    const pair = await service.login({ identifier: "a@b.com", password: "pw123456" });

    await service.logout(pair.refreshToken);
    await expect(service.refresh(pair.refreshToken)).rejects.toBeInstanceOf(DomainError);
    expect(blacklist.revoked.size).toBeGreaterThan(0);
  });

  it("非法密码被拒（不区分邮箱/密码）", async () => {
    const { service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");
    await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });
    await expect(service.login({ identifier: "a@b.com", password: "wrong" })).rejects.toBeInstanceOf(DomainError);
    await expect(service.login({ identifier: "none@b.com", password: "pw123456" })).rejects.toBeInstanceOf(DomainError);
  });

  it("admin RBAC 两档：admin 全权限，staff 受限", async () => {
    const { repo, hasher, service } = setup();
    await service.seedRoles();

    const admin = await repo.insertAdminUser({ email: "admin@x.com" });
    await repo.assignRole(admin.id, repo.roleByName("admin")!.id);
    const adminIdent = await repo.insertIdentity({ email: "admin@x.com", scope: "admin", adminUserId: admin.id });
    await repo.insertCredential(adminIdent.id, await hasher.hash("adminpw"));

    const staff = await repo.insertAdminUser({ email: "staff@x.com" });
    await repo.assignRole(staff.id, repo.roleByName("staff")!.id);
    const staffIdent = await repo.insertIdentity({ email: "staff@x.com", scope: "admin", adminUserId: staff.id });
    await repo.insertCredential(staffIdent.id, await hasher.hash("staffpw"));

    const adminPair = await service.adminLogin({ email: "admin@x.com", password: "adminpw" });
    const adminCtx = await service.verifyAccessToken(adminPair.accessToken);
    expect(adminCtx.permissions).toBe("all");
    expect(() => service.assertPermission(adminCtx, "settings")).not.toThrow();

    const staffPair = await service.adminLogin({ email: "staff@x.com", password: "staffpw" });
    const staffCtx = await service.verifyAccessToken(staffPair.accessToken);
    expect(staffCtx.roles).toContain("staff");
    expect(() => service.assertPermission(staffCtx, "products")).not.toThrow();
    expect(() => service.assertPermission(staffCtx, "settings")).toThrow(DomainError);
  });
});

describe("找回密码（重置 / 首次设密码）", () => {
  it("邮箱账号：重置后旧密码失效、新密码可登录、旧会话被撤销", async () => {
    const { service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");
    await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });
    const pair = await service.login({ identifier: "a@b.com", password: "pw123456" });

    const forgot = await service.requestPasswordReset({ identifier: "a@b.com" });
    expect(forgot.channel).toBe("email");
    const resetCode = lastCodeOf(mailer);

    const res = await service.resetPassword({
      identifier: "a@b.com",
      code: resetCode,
      newPassword: "newpw123456",
    });
    expect(res.revokedRefreshTokens).toBe(1);

    await expect(
      service.login({ identifier: "a@b.com", password: "pw123456" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      service.login({ identifier: "a@b.com", password: "newpw123456" }),
    ).resolves.toMatchObject({ scope: "customer" });
    // 旧会话不能靠 refresh 续命
    await expect(service.refresh(pair.refreshToken)).rejects.toBeInstanceOf(DomainError);
  });

  it("手机号账号：短信验证码重置（这条路同时是「首次设密码」）", async () => {
    const { service, sms } = setup({ register_mode: "phone" });
    await service.sendVerificationCode({ channel: "sms", target: PHONE, purpose: "login" });
    await service.loginWithPhoneCode({ phone: PHONE, code: lastCodeOf(sms) });

    const forgot = await service.requestPasswordReset({ identifier: PHONE });
    expect(forgot.channel).toBe("sms");
    await service.resetPassword({
      identifier: PHONE,
      code: lastCodeOf(sms),
      newPassword: "newpw123456",
    });

    // 以前只能验证码登录，现在有密码了
    await expect(service.login({ identifier: PHONE, password: "newpw123456" })).resolves.toMatchObject({
      scope: "customer",
    });
  });

  it("未注册的账号直接提示（不假装已发送）", async () => {
    const { service } = setup();
    await expect(
      service.requestPasswordReset({ identifier: "none@b.com" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      service.requestPasswordReset({ identifier: "13900000000" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("弱密码被拒，且原密码仍然可用", async () => {
    const { service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");
    await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });
    await service.requestPasswordReset({ identifier: "a@b.com" });
    const resetCode = lastCodeOf(mailer);

    await expect(
      service.resetPassword({ identifier: "a@b.com", code: resetCode, newPassword: "123" }),
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      service.login({ identifier: "a@b.com", password: "pw123456" }),
    ).resolves.toMatchObject({ scope: "customer" });
  });

  it("验证码一次性：同一码不能重置两次", async () => {
    const { service, mailer } = setup();
    const code = await emailCodeFor(service, mailer, "a@b.com");
    await service.register({
      email: "a@b.com",
      password: "pw123456",
      phone: PHONE,
      channel: "email",
      code,
    });
    await service.requestPasswordReset({ identifier: "a@b.com" });
    const resetCode = lastCodeOf(mailer);

    await service.resetPassword({
      identifier: "a@b.com",
      code: resetCode,
      newPassword: "newpw123456",
    });
    await expect(
      service.resetPassword({
        identifier: "a@b.com",
        code: resetCode,
        newPassword: "another123456",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("顾客账号设置（注册方式切换）", () => {
  it("默认邮箱注册", async () => {
    const { service } = setup();
    await expect(service.getSettings()).resolves.toEqual({ register_mode: "email" });
  });

  it("切到手机号注册后读回来是 phone", async () => {
    const { service } = setup();
    await service.updateSettings({ register_mode: "phone" });
    await expect(service.getSettings()).resolves.toEqual({ register_mode: "phone" });
  });

  it("非法注册方式被拒", async () => {
    const { service } = setup();
    await expect(
      service.updateSettings({ register_mode: "sms" as never }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
