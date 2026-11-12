import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 顾客注册方式（ADR-025）的接口契约。
 *
 * 这一层只验薄壳：公开读、后台写要 settings 权限、写操作落审计、
 * 注册入参校验（手机号与验证码必填）。
 * 「注册方式关掉后接口必须拒绝」这类规则在模块单测里守着，这里不复刻。
 */
async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof buildApp>>,
    deps: ReturnType<typeof makeDeps>,
  ) => Promise<void>,
) {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const adminJson = { authorization: "Bearer admin", "content-type": "application/json" };
const staffJson = { authorization: "Bearer staff", "content-type": "application/json" };
const json = { "content-type": "application/json" };

const registerBody = {
  email: "a@b.com",
  password: "password123",
  phone: "13800001111",
  channel: "email",
  code: "123456",
};

describe("顾客注册方式（店面）", () => {
  it("注册方式是公开信息：未登录也能读到，默认邮箱注册", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/auth/settings" });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toEqual({ register_mode: "email" });
    });
  });

  it("注册必须带手机号：缺 phone → 400", async () => {
    await withApp(async (app) => {
      const { phone: _omit, ...withoutPhone } = registerBody;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/register",
        headers: json,
        payload: withoutPhone,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("注册必须带验证码：缺 code → 400", async () => {
    await withApp(async (app) => {
      const { code: _omit, ...withoutCode } = registerBody;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/register",
        headers: json,
        payload: withoutCode,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("带齐邮箱 + 密码 + 手机号 + 验证码 → 201", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/register",
        headers: json,
        payload: registerBody,
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().data).toMatchObject({ identity_id: "aid", customer_id: "cust_1" });
    });
  });

  it("验证码支持发到邮箱（channel=email，target 是邮箱）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/codes",
        headers: json,
        payload: { channel: "email", target: "a@b.com", purpose: "register" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.sent).toBe(true);
    });
  });
});

describe("顾客注册方式（后台）", () => {
  it("未登录不可读后台设置", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/auth" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("admin 可读可改，并落审计", async () => {
    await withApp(async (app, deps) => {
      const got = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/auth",
        headers: { authorization: "Bearer admin" },
      });
      expect(got.statusCode, got.body).toBe(200);
      expect(got.json().data).toEqual({ register_mode: "email" });

      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/auth",
        headers: adminJson,
        payload: { register_mode: "phone" },
      });
      expect(put.statusCode, put.body).toBe(200);
      expect(put.json().data).toEqual({ register_mode: "phone" });

      // 改完之后店面读到的是新值（同一个来源，不能各存一份）
      const store = await app.inject({ method: "GET", url: "/api/v1/store/auth/settings" });
      expect(store.json().data).toEqual({ register_mode: "phone" });

      const entry = deps.auditRepo.rows.find((r) => r.action === "auth.settings.update");
      expect(entry).toBeTruthy();
      expect(entry!.entityType).toBe("auth_settings");
    });
  });

  it("staff 没有 settings 权限 → 403", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/auth",
        headers: staffJson,
        payload: { register_mode: "phone" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  it("非法注册方式 → 400", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/auth",
        headers: adminJson,
        payload: { register_mode: "sms" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
