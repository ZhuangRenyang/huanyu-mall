import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 到货提醒邮件开关（ADR-059）。
 *
 * 为什么单独守：`settingsBody` 是普通 zod object（非 strict），
 * 没写进 schema 的字段会被**静默丢掉** —— 后台点了「关闭到货提醒」，
 * 接口 200、界面也回显成功，但开关其实没生效。这类错只能靠「写进去能不能读回来」验。
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

describe("通知设置：到货提醒开关", () => {
  it("默认开启（顾客主动登记了提醒，不发等于失信）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/notifications/settings",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.stock_alert_enabled).toBe(true);
    });
  });

  it("关掉后能读回来（字段没被 zod 丢掉）", async () => {
    await withApp(async (app) => {
      // 设置写接口是 PUT（不是 PATCH）：方法错了会 404，测试要跟真实路由一致
      const patch = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/notifications/settings",
        headers: adminJson,
        payload: { stock_alert_enabled: false },
      });
      expect(patch.statusCode, patch.body).toBe(200);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/notifications/settings",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.json().data.stock_alert_enabled).toBe(false);
      // 其他开关不受影响
      expect(res.json().data.order_confirmation_enabled).toBe(true);
    });
  });
});
