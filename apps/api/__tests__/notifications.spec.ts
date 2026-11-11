import { describe, expect, it } from "vitest";
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
const staff = { authorization: "Bearer staff" };
const adminJson = { ...admin, "content-type": "application/json" };

describe("邮件通知后台接口（ADR-016）", () => {
  it("设置：默认关闭、响应里永不出现密码字段", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/notifications/settings",
        headers: admin,
      });
      expect(res.statusCode).toBe(200);
      const dto = res.json().data;
      expect(dto.enabled).toBe(false);
      expect(dto.smtp_password_set).toBe(false);
      expect(Object.keys(dto)).not.toContain("smtp_password");
    });
  });

  it("保存设置：密码只留 set 标记；审计记的是标记而不是密码", async () => {
    await withApp(async (app, deps) => {
      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/notifications/settings",
        headers: adminJson,
        payload: {
          enabled: true,
          from_name: "商城",
          from_email: "noreply@example.com",
          smtp_host: "smtp.example.com",
          smtp_port: 465,
          smtp_secure: true,
          smtp_password: "s3cret-value",
        },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().data.smtp_password_set).toBe(true);
      expect(put.body).not.toContain("s3cret-value");

      const audit = deps.auditRepo.rows.find((r) => r.action === "notification.settings.update");
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit)).not.toContain("s3cret-value");
    });
  });

  it("端口越界 → 400 可读错误", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/notifications/settings",
        headers: adminJson,
        payload: { smtp_port: 70000 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("测试发送：SMTP 未配置时返回 4xx 且带可读原因", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/notifications/test",
        headers: adminJson,
        payload: { to: "buyer@example.com" },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(res.json().message).toContain("SMTP");
    });
  });

  it("通知记录：列表 + 重发返回最新状态", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/notifications/settings",
        headers: adminJson,
        payload: { enabled: true, from_email: "noreply@example.com", smtp_host: "smtp.example.com" },
      });
      // 先造一条记录（替身里由测试发送/入队产生）
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/notifications/test",
        headers: adminJson,
        payload: { to: "buyer@example.com" },
      });
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/notifications?limit=10",
        headers: admin,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.count).toBeGreaterThanOrEqual(1);
      const id = list.json().data.items[0].id;

      const resend = await app.inject({
        method: "POST",
        url: `/api/v1/admin/notifications/${id}/resend`,
        headers: admin,
      });
      expect(resend.statusCode).toBe(200);
      expect(resend.json().data.status).toBe("sent");
    });
  });

  it("鉴权：匿名 401；staff 无 settings 权限 403", async () => {
    await withApp(async (app) => {
      const anon = await app.inject({ method: "GET", url: "/api/v1/admin/notifications" });
      expect(anon.statusCode).toBe(401);

      const asStaff = await app.inject({
        method: "GET",
        url: "/api/v1/admin/notifications/settings",
        headers: staff,
      });
      expect(asStaff.statusCode).toBe(403);
    });
  });
});
