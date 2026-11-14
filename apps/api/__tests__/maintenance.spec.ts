import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 维护页（ADR-076）。
 *
 * 只验「给得出、给得对、进不来」三件事：
 * 1. 没登录 / staff 都读不到（里面含系统探针与审计流水，属管理员视角）；
 * 2. 结构齐全：探针、邮件队列、数据规模、最近审计；
 * 3. 探针在测试环境必然连不上，返回 degraded 而不是报 500 ——
 *    维护页本身不能因为「数据库挂了」而打不开，那正是最需要它的时候。
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

const admin = { authorization: "Bearer admin" };

describe("维护状态（ADR-076）", () => {
  it("未登录 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/maintenance/status" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("staff 无 settings 权限 → 403（系统探针与审计不对外）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/maintenance/status",
        headers: { authorization: "Bearer staff" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  it("管理员可读：探针 / 邮件队列 / 数据规模 / 最近审计齐全", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/maintenance/status",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data as Record<string, any>;

      // 探针：测试环境连不上库/Redis，必须是 degraded 而不是抛错
      expect(["ok", "degraded"]).toContain(data.system.status);
      expect(["ok", "degraded"]).toContain(data.system.db);
      expect(typeof data.system.migrations).toBe("string");
      expect(typeof data.system.uptime).toBe("number");
      expect(typeof data.system.node).toBe("string");

      expect(data.mail).toMatchObject({
        pending: expect.any(Number),
        failed: expect.any(Number),
        sent: expect.any(Number),
      });
      expect(data.data).toMatchObject({
        orders: expect.any(Number),
        products: expect.any(Number),
        customers: expect.any(Number),
      });
      expect(Array.isArray(data.audit.recent)).toBe(true);
      expect(typeof data.audit.count).toBe("number");
    });
  });
});
