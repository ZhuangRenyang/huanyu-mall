import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { AuthService } from "../src/services/auth.service.js";
import { Argon2PasswordHasher } from "../src/services/password.js";
import { checkPasswordStrength } from "../src/services/password-policy.js";
import {
  CONFIG,
  FakeCustomerPort,
  InMemoryAuthRepository,
  InMemoryBlacklist,
} from "./helpers/in-memory-auth.js";

const OLD_PASSWORD = "oldpw123456";
const NEW_PASSWORD = "newpw654321";

function setup() {
  const repo = new InMemoryAuthRepository();
  const blacklist = new InMemoryBlacklist();
  const hasher = new Argon2PasswordHasher();
  const service = new AuthService({
    repo,
    hasher,
    customer: new FakeCustomerPort(),
    config: CONFIG,
    blacklist,
  });
  return { repo, blacklist, hasher, service };
}

/** 建一个已登录的管理员，返回其 identityId 与 refresh_token。 */
async function createAdmin(
  ctx: ReturnType<typeof setup>,
  password = OLD_PASSWORD,
): Promise<{ identityId: string; refreshToken: string }> {
  const { repo, hasher, service } = ctx;
  await service.seedRoles();
  const admin = await repo.insertAdminUser({ email: "admin@x.com" });
  await repo.assignRole(admin.id, repo.roleByName("admin")!.id);
  const identity = await repo.insertIdentity({
    email: "admin@x.com",
    scope: "admin",
    adminUserId: admin.id,
  });
  await repo.insertCredential(identity.id, await hasher.hash(password));
  const pair = await service.adminLogin({ email: "admin@x.com", password });
  return { identityId: identity.id, refreshToken: pair.refreshToken };
}

describe("管理员改密（AuthService.changeAdminPassword）", () => {
  it("1. 当前口令错误 → 拒绝（凭证错误 10005），且不改动任何状态", async () => {
    const ctx = setup();
    const { identityId } = await createAdmin(ctx);

    await expect(
      ctx.service.changeAdminPassword({
        identityId,
        currentPassword: "wrong-password",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 10005 });

    // 口令未被改动，旧口令仍可登录
    await expect(
      ctx.service.adminLogin({ email: "admin@x.com", password: OLD_PASSWORD }),
    ).resolves.toBeTruthy();
  });

  it("2. 新口令强度不足 → 拒绝（20001）", async () => {
    const ctx = setup();
    const { identityId } = await createAdmin(ctx);

    for (const weak of ["Ab1", "abcdefgh", "12345678"]) {
      await expect(
        ctx.service.changeAdminPassword({
          identityId,
          currentPassword: OLD_PASSWORD,
          newPassword: weak,
        }),
      ).rejects.toMatchObject({ code: 20001 });
    }
    // 强度策略本身：至少 8 位 + 字母 + 数字
    expect(checkPasswordStrength("abcdefgh").ok).toBe(false);
    expect(checkPasswordStrength("abcdefg1").ok).toBe(true);
  });

  it("3. 新口令与当前口令相同 → 拒绝（20001）", async () => {
    const ctx = setup();
    const { identityId } = await createAdmin(ctx);

    await expect(
      ctx.service.changeAdminPassword({
        identityId,
        currentPassword: OLD_PASSWORD,
        newPassword: OLD_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 20001 });
  });

  it("4. 改密后该管理员全部 refresh_token 失效（黑名单同步）", async () => {
    const ctx = setup();
    const { identityId, refreshToken } = await createAdmin(ctx);
    // 再造一个同管理员的会话，两条都要被撤销
    const second = await ctx.service.adminLogin({ email: "admin@x.com", password: OLD_PASSWORD });

    const result = await ctx.service.changeAdminPassword({
      identityId,
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(result.revokedRefreshTokens).toBe(2);
    expect(ctx.blacklist.revoked.size).toBe(2);

    await expect(ctx.service.refresh(refreshToken)).rejects.toBeInstanceOf(DomainError);
    await expect(ctx.service.refresh(second.refreshToken)).rejects.toBeInstanceOf(DomainError);
  });

  it("5. 改密成功：新口令可登录、旧口令不可登录，且不签发新 token", async () => {
    const ctx = setup();
    const { identityId } = await createAdmin(ctx);

    const result = await ctx.service.changeAdminPassword({
      identityId,
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ revokedRefreshTokens: 1 });

    const pair = await ctx.service.adminLogin({ email: "admin@x.com", password: NEW_PASSWORD });
    expect(pair.accessToken).toBeTruthy();
    await expect(
      ctx.service.adminLogin({ email: "admin@x.com", password: OLD_PASSWORD }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("6. 非管理员身份不能走改密", async () => {
    const ctx = setup();
    // 直接落库建顾客身份：注册现在要验证码，这里测的是改密的身份校验，不走注册流程
    const identity = await ctx.repo.insertIdentity({ email: "a@b.com", scope: "customer" });
    await ctx.repo.insertCredential(identity.id, await ctx.hasher.hash("cust123456"));

    await expect(
      ctx.service.changeAdminPassword({
        identityId: identity.id,
        currentPassword: "cust123456",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 10005 });
  });
});
