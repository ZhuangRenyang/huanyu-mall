import { describe, expect, it } from "vitest";

// 代理鉴权用环境变量里的 token；测试里固定一个值
process.env.UPDATER_TOKEN = "test-updater-token";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

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
const adminJson = { ...admin, "content-type": "application/json" };
const agentJson = {
  authorization: "Bearer test-updater-token",
  "content-type": "application/json",
};

describe("系统信息与一键升级（ADR-017）", () => {
  it("系统信息：版本、健康、代理在线状态、最近作业", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/system/info",
        headers: admin,
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(typeof data.version).toBe("string");
      expect(data.health.db).toBe("ok");
      expect(data.updater_online).toBe(false);
      expect(data.settings.update_source_url).toBe("");
    });
  });

  it("更新源：非法协议 400；未配置时检查更新给 reason 而不是报错", async () => {
    await withApp(async (app) => {
      const bad = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/system/settings",
        headers: adminJson,
        payload: { update_source_url: "javascript:alert(1)" },
      });
      expect(bad.statusCode).toBe(400);

      const ok = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/system/settings",
        headers: adminJson,
        payload: { update_source_url: "https://releases.example.com/mall/latest.json" },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data.update_source_url).toContain("releases.example.com");

      const check = await app.inject({
        method: "POST",
        url: "/api/v1/admin/system/check-update",
        headers: admin,
      });
      expect(check.statusCode).toBe(200);
      expect(check.json().data.has_update).toBe(true);
      expect(check.json().data.latest.version).toBe("1.1.0");
    });
  });

  it("升级是破坏性操作：不带 confirm 会被 schema 拒绝", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/system/upgrade",
        headers: adminJson,
        payload: {
          version: "1.1.0",
          tarball_url: "https://example.com/mall.tar.gz",
          sha256: "a".repeat(64),
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("升级作业：创建 → 代理领取 → 报进度 → 报结果，全程可见", async () => {
    await withApp(async (app, deps) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/system/upgrade",
        headers: adminJson,
        payload: {
          version: "1.1.0",
          tarball_url: "https://example.com/mall.tar.gz",
          sha256: "a".repeat(64),
          confirm: true,
        },
      });
      expect(created.statusCode).toBe(201);
      const jobId = created.json().data.id;
      expect(created.json().data.status).toBe("queued");
      expect(deps.auditRepo.rows.some((r) => r.action === "system.upgrade.request")).toBe(true);

      // 代理侧
      const heartbeat = await app.inject({
        method: "POST",
        url: "/api/v1/system-update/agent/heartbeat",
        headers: agentJson,
        payload: { version: "mall-updater/1.0.0" },
      });
      expect(heartbeat.statusCode).toBe(200);

      const next = await app.inject({
        method: "GET",
        url: "/api/v1/system-update/agent/next",
        headers: agentJson,
      });
      expect(next.statusCode).toBe(200);
      expect(next.json().data.job.id).toBe(jobId);
      expect(next.json().data.job.status).toBe("running");

      await app.inject({
        method: "POST",
        url: `/api/v1/system-update/agent/jobs/${jobId}/progress`,
        headers: agentJson,
        payload: { progress: 40, step: "备份数据库", log: "pg_dump 完成" },
      });
      const mid = await app.inject({
        method: "GET",
        url: `/api/v1/admin/system/jobs/${jobId}`,
        headers: admin,
      });
      expect(mid.json().data.progress).toBe(40);
      expect(mid.json().data.step).toBe("备份数据库");
      expect(mid.json().data.log).toContain("pg_dump 完成");

      await app.inject({
        method: "POST",
        url: `/api/v1/system-update/agent/jobs/${jobId}/complete`,
        headers: agentJson,
        payload: { status: "succeeded", result: { version: "1.1.0" } },
      });
      const done = await app.inject({
        method: "GET",
        url: `/api/v1/admin/system/jobs/${jobId}`,
        headers: admin,
      });
      expect(done.json().data.status).toBe("succeeded");
      expect(done.json().data.progress).toBe(100);

      // 心跳后代理应显示在线
      const info = await app.inject({
        method: "GET",
        url: "/api/v1/admin/system/info",
        headers: admin,
      });
      expect(info.json().data.updater_online).toBe(true);
    });
  });

  it("代理鉴权：错 token 401；管理员端点不能用代理 token", async () => {
    await withApp(async (app) => {
      const bad = await app.inject({
        method: "GET",
        url: "/api/v1/system-update/agent/next",
        headers: { authorization: "Bearer wrong" },
      });
      expect(bad.statusCode).toBe(401);

      const anon = await app.inject({ method: "GET", url: "/api/v1/admin/system/info" });
      expect(anon.statusCode).toBe(401);

      const withAgentToken = await app.inject({
        method: "GET",
        url: "/api/v1/admin/system/info",
        headers: { authorization: "Bearer test-updater-token" },
      });
      expect(withAgentToken.statusCode).toBe(401);
    });
  });
});
