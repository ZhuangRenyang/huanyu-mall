import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 顾客自助改密（ADR-055）。
 *
 * 之前只有「忘记密码」：收验证码 → 重设。记得密码的顾客想换密码，
 * 被逼着走一遍「密码丢了」的流程。
 *
 * 这里守四件事：
 * 1. 必须登录（匿名不能改密）；
 * 2. 身份取 token，body 传 identity_id 无效（否则能改别人的密码）；
 * 3. 当前口令错 → 401；新口令太弱/与原口令相同 → 400；
 * 4. 成功后撤销会话（revoked_refresh_tokens > 0）。
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

const asCustomer = { authorization: "Bearer customer", "content-type": "application/json" };

describe("顾客改密", () => {
  it("未登录 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/change",
        headers: { "content-type": "application/json" },
        payload: { current_password: "demo1234", new_password: "next12345" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  it("当前口令错 → 401（不能让不知道旧密码的人改密码）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/change",
        headers: asCustomer,
        payload: { current_password: "wrong-pass", new_password: "next12345" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  it("新口令太短 / 与原口令相同 → 400", async () => {
    await withApp(async (app) => {
      const short = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/change",
        headers: asCustomer,
        payload: { current_password: "demo1234", new_password: "abc123" },
      });
      expect(short.statusCode).toBe(400);

      const same = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/change",
        headers: asCustomer,
        payload: { current_password: "demo1234", new_password: "demo1234" },
      });
      expect(same.statusCode).toBe(400);
    });
  });

  it("成功：撤销全部会话（revoked > 0），旧口令随之失效", async () => {
    await withApp(async (app, deps) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/change",
        headers: asCustomer,
        payload: { current_password: "demo1234", new_password: "next12345" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.revoked_refresh_tokens).toBeGreaterThan(0);
      // 口径：改密后服务端记的是新口令
      expect(deps.state.customerPassword).toBe("next12345");

      // 再用旧口令改一次 → 401（说明旧口令真的不再被接受）
      const again = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/change",
        headers: asCustomer,
        payload: { current_password: "demo1234", new_password: "another123" },
      });
      expect(again.statusCode).toBe(401);
    });
  });

  it("body 传 identity_id 不起作用：身份只认 token", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/password/change",
        headers: asCustomer,
        payload: {
          current_password: "demo1234",
          new_password: "next12345",
          identity_id: "ident_admin",
        },
      });
      // strict 之外的字段被 zod 忽略，改的仍是自己
      expect(res.statusCode).toBe(200);
    });
  });
});
