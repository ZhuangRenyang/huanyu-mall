import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 忘记密码（ADR-027）的接口契约。
 *
 * 只验薄壳：账号不存在要明确报（404），发码通道跟着账号类型走，
 * 重置成功返回 204 且不签发 token。真正的重置逻辑在 auth 模块单测里守着。
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

const json = { "content-type": "application/json" };

describe("忘记密码", () => {
  it("邮箱账号：发码走邮件通道", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/forgot",
        headers: json,
        payload: { identifier: "a@b.com" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ sent: true, channel: "email" });
    });
  });

  it("手机号账号：发码走短信通道", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/forgot",
        headers: json,
        payload: { identifier: "13800001111" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ sent: true, channel: "sms" });
    });
  });

  it("未注册账号 → 404，并把账号带在提示里", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/forgot",
        headers: json,
        payload: { identifier: "none@b.com" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toContain("未注册");
    });
  });

  it("重置成功 → 204，不签发 token", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/reset",
        headers: json,
        payload: { identifier: "a@b.com", code: "123456", new_password: "newpw123456" },
      });
      expect(res.statusCode, res.body).toBe(204);
      expect(res.body).toBe("");
    });
  });

  it("验证码错 → 400（业务码 20001）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/reset",
        headers: json,
        payload: { identifier: "a@b.com", code: "000000", new_password: "newpw123456" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(20001);
    });
  });

  it("新密码太短 → 400（路由层就挡住）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/reset",
        headers: json,
        payload: { identifier: "a@b.com", code: "123456", new_password: "short" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
