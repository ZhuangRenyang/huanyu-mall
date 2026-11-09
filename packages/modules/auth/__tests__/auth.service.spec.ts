import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { AuthService } from "../src/services/auth.service.js";
import { Argon2PasswordHasher } from "../src/services/password.js";
import {
  CONFIG,
  FakeCustomerPort,
  InMemoryAuthRepository,
  InMemoryBlacklist,
} from "./helpers/in-memory-auth.js";

function setup() {
  const repo = new InMemoryAuthRepository();
  const blacklist = new InMemoryBlacklist();
  const hasher = new Argon2PasswordHasher();
  const service = new AuthService({ repo, hasher, customer: new FakeCustomerPort(), config: CONFIG, blacklist });
  return { repo, blacklist, hasher, service };
}

describe("AuthService（M11，JWT + refresh 轮换单飞 + RBAC）", () => {
  it("注册 → 登录 → 校验 access token", async () => {
    const { service } = setup();
    const reg = await service.register({ email: "a@b.com", password: "pw123456" });
    expect(reg.customerId).toMatch(/^cust_/);

    const pair = await service.login({ email: "a@b.com", password: "pw123456" });
    expect(pair.accessToken.split(".")).toHaveLength(3);
    const ctx = await service.verifyAccessToken(pair.accessToken);
    expect(ctx.scope).toBe("customer");
    expect(ctx.sub).toBe(reg.identityId);
  });

  it("refresh 轮换：旧 token 立即失效", async () => {
    const { service } = setup();
    await service.register({ email: "a@b.com", password: "pw123456" });
    const pair = await service.login({ email: "a@b.com", password: "pw123456" });

    const next = await service.refresh(pair.refreshToken);
    expect(next.refreshToken).not.toBe(pair.refreshToken);
    await expect(service.refresh(pair.refreshToken)).rejects.toBeInstanceOf(DomainError);
    await expect(service.verifyAccessToken(next.accessToken)).resolves.toMatchObject({ scope: "customer" });
  });

  it("并发刷新只发一次新 token（单飞）", async () => {
    const { repo, service } = setup();
    await service.register({ email: "a@b.com", password: "pw123456" });
    const pair = await service.login({ email: "a@b.com", password: "pw123456" });

    const [r1, r2] = await Promise.all([
      service.refresh(pair.refreshToken),
      service.refresh(pair.refreshToken),
    ]);
    expect(r1.refreshToken).toBe(r2.refreshToken);
    const rows = [...repo.refreshTokens.values()].filter((t) => t.auth_identity_id === pair.identityId);
    expect(rows).toHaveLength(2); // 登录 token（已撤销）+ 1 个新 token
  });

  it("登出后 refresh 失效（黑名单/撤销生效）", async () => {
    const { blacklist, service } = setup();
    await service.register({ email: "a@b.com", password: "pw123456" });
    const pair = await service.login({ email: "a@b.com", password: "pw123456" });

    await service.logout(pair.refreshToken);
    await expect(service.refresh(pair.refreshToken)).rejects.toBeInstanceOf(DomainError);
    expect(blacklist.revoked.size).toBeGreaterThan(0);
  });

  it("非法密码被拒（不区分邮箱/密码）", async () => {
    const { service } = setup();
    await service.register({ email: "a@b.com", password: "pw123456" });
    await expect(service.login({ email: "a@b.com", password: "wrong" })).rejects.toBeInstanceOf(DomainError);
    await expect(service.login({ email: "none@b.com", password: "pw123456" })).rejects.toBeInstanceOf(DomainError);
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
