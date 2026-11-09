import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

async function withApp(
  fn: (app: Awaited<ReturnType<typeof buildApp>>, deps: ReturnType<typeof makeDeps>) => Promise<void>,
): Promise<void> {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const adminHeaders = { authorization: "Bearer admin", "content-type": "application/json" };
const CURRENT_PASSWORD = "pw123456";
const NEW_PASSWORD = "newpw654321";

describe("管理员改密端点（Phase 4 D）", () => {
  it("1. 未带 token → 401；改密成功返回重新登录提示", async () => {
    await withApp(async (app) => {
      const anonymous = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/change-password",
        headers: { "content-type": "application/json" },
        payload: { current_password: CURRENT_PASSWORD, new_password: NEW_PASSWORD },
      });
      expect(anonymous.statusCode).toBe(401);

      const ok = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/change-password",
        headers: adminHeaders,
        payload: { current_password: CURRENT_PASSWORD, new_password: NEW_PASSWORD },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().code).toBe(0);
      expect(ok.json().data.changed).toBe(true);
      expect(ok.json().data.reauth_required).toBe(true);
      expect(ok.json().data.message).toBe("密码已修改，请使用新密码重新登录");
    });
  });

  it("2. 当前口令错误 → 拒绝（凭证错误 10005）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/change-password",
        headers: adminHeaders,
        payload: { current_password: "wrong-password", new_password: NEW_PASSWORD },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe(10005);
      expect(res.json().message).toBe("凭证错误");
    });
  });

  it("3. 新口令强度不足 → 拒绝（20001），且旧口令仍然有效", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/change-password",
        headers: adminHeaders,
        payload: { current_password: CURRENT_PASSWORD, new_password: "abc" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(20001);
      expect(res.json().message).toContain("至少 8 位");

      const login = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "admin@x.com", password: CURRENT_PASSWORD },
      });
      expect(login.statusCode).toBe(200);
    });
  });

  it("4. 改密后：新口令可登录、旧口令不可登录", async () => {
    await withApp(async (app) => {
      const changed = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/change-password",
        headers: adminHeaders,
        payload: { current_password: CURRENT_PASSWORD, new_password: NEW_PASSWORD },
      });
      expect(changed.statusCode).toBe(200);

      const oldLogin = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "admin@x.com", password: CURRENT_PASSWORD },
      });
      expect(oldLogin.statusCode).toBe(401);

      const newLogin = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "admin@x.com", password: NEW_PASSWORD },
      });
      expect(newLogin.statusCode).toBe(200);
    });
  });

  it("5. 写审计：只记操作者/动作/实体，不含口令明文或哈希", async () => {
    await withApp(async (app, deps) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/change-password",
        headers: adminHeaders,
        payload: { current_password: CURRENT_PASSWORD, new_password: NEW_PASSWORD },
      });

      const rows = deps.auditRepo.rows.filter((r) => r.action === "admin.change_password");
      expect(rows).toHaveLength(1);
      const entry = rows[0]!;
      expect(entry.actorType).toBe("admin");
      expect(entry.actorId).toBe("adm_1");
      expect(entry.entityType).toBe("admin_user");
      expect(entry.entityId).toBe("adm_1");

      const snapshot = JSON.stringify(entry);
      expect(snapshot).not.toContain(CURRENT_PASSWORD);
      expect(snapshot).not.toContain(NEW_PASSWORD);
      expect(snapshot).not.toMatch(/\$argon2/);
    });
  });

  it("6. 审计写失败不影响改密主流程", async () => {
    await withApp(async (app, deps) => {
      deps.auditRepo.failNextInsert = true;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/change-password",
        headers: adminHeaders,
        payload: { current_password: CURRENT_PASSWORD, new_password: NEW_PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.changed).toBe(true);
    });
  });
});
