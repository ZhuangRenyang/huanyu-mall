import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 外观设置与店铺 Logo（ADR-046）。
 *
 * 之前只有 PUT 没有 GET：后台读外观设置 404，前端 catch 后静默回落默认值，
 * 商家改完保存成功、刷新又看到默认配色，以为没保存。
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
const admin = { authorization: "Bearer admin" };

describe("外观设置读回", () => {
  it("GET theme 返回已保存的配色（此前该端点不存在，总是回默认值）", async () => {
    await withApp(async (app) => {
      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { primary_color: "#FF0000", border_radius: "12px" },
      });
      expect(put.statusCode, put.body).toBe(200);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/theme",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.theme.primary_color).toBe("#FF0000");
      expect(res.json().data.theme.border_radius).toBe("12px");
      // 没设 logo 时给 null，而不是空串或 undefined
      expect(res.json().data.theme.logo_url).toBeNull();
    });
  });

  it("未登录读不到外观设置", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/theme" });
      expect(res.statusCode).toBe(401);
    });
  });
});

describe("店铺 Logo", () => {
  it("设置 logo 后，后台读回 logo_url，店面 bootstrap 也带出去", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { logo_file_id: "file_logo_1" },
      });

      const adminTheme = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/theme",
        headers: admin,
      });
      expect(adminTheme.json().data.theme.logo_url).toBe("/uploads/file_logo_1");

      const boot = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(boot.json().data.theme.logo_url).toBe("/uploads/file_logo_1");
    });
  });

  it("删除 logo（传 null）后两处都回到 null", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { logo_file_id: "file_logo_1" },
      });
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { logo_file_id: null },
      });

      const boot = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(boot.json().data.theme.logo_url).toBeNull();
    });
  });

  it("保存外观时只提交配色，logo 不会被抹掉（合并语义）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { logo_file_id: "file_logo_1" },
      });
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { primary_color: "#00AA00" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/theme",
        headers: admin,
      });
      expect(res.json().data.theme.primary_color).toBe("#00AA00");
      expect(res.json().data.theme.logo_url).toBe("/uploads/file_logo_1");
    });
  });
});

describe("店铺公告（ADR-047）", () => {
  it("保存后能读回，也出现在店面 bootstrap（公告条全站可见）", async () => {
    await withApp(async (app) => {
      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { announcement: "  双十一全场 8 折，满 199 包邮  " },
      });
      expect(put.statusCode, put.body).toBe(200);

      const adminTheme = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/theme",
        headers: admin,
      });
      // 首尾空格被裁掉：公告是一条单行文本，不该带着空格渲染
      expect(adminTheme.json().data.theme.announcement).toBe("双十一全场 8 折，满 199 包邮");

      const boot = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(boot.json().data.theme.announcement).toBe("双十一全场 8 折，满 199 包邮");
    });
  });

  it("清空公告后为 null（不显示公告条）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { announcement: "旧公告" },
      });
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { announcement: "   " },
      });

      const boot = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(boot.json().data.theme.announcement).toBeNull();
    });
  });

  it("公告超过 40 字被拒（页面也是一行输入框）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/theme",
        headers: adminJson,
        payload: { announcement: "字".repeat(41) },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
