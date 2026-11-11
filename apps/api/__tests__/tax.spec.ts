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
const adminJson = { ...admin, "content-type": "application/json" };

describe("税务配置后台接口（ADR-018：可按国家切换、可调整）", () => {
  it("默认：未开启、没有默认税率、没有国家覆盖", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/tax", headers: admin });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({
        settings: { enabled: false, tax_name: "税", prices_include_tax: true },
        default_rate: null,
        country_rates: [],
      });
    });
  });

  it("改总开关与税名，并写审计", async () => {
    await withApp(async (app, deps) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/tax/settings",
        headers: adminJson,
        payload: { enabled: true, tax_name: "增值税", prices_include_tax: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        enabled: true,
        tax_name: "增值税",
        prices_include_tax: false,
      });
      expect(deps.auditRepo.rows.some((r) => r.action === "tax.settings.update")).toBe(true);
    });
  });

  it("设默认税率 + 两国覆盖：一次读全，国家码归一为大写", async () => {
    await withApp(async (app) => {
      const put = (url: string, payload: Record<string, unknown>) =>
        app.inject({ method: "PUT", url, headers: adminJson, payload });

      expect(
        (await put("/api/v1/admin/tax/default-rate", { name: "标准税率", rate_bps: 1000 }))
          .statusCode,
      ).toBe(200);
      expect(
        (await put("/api/v1/admin/tax/country-rates/CN", { name: "中国增值税", rate_bps: 1300 }))
          .statusCode,
      ).toBe(200);
      // 小写也接受，存成大写
      const us = await put("/api/v1/admin/tax/country-rates/us", {
        name: "美国销售税",
        rate_bps: 800,
      });
      expect(us.json().data.country_code).toBe("US");

      const res = await app.inject({ method: "GET", url: "/api/v1/admin/tax", headers: admin });
      const data = res.json().data;
      expect(data.default_rate).toMatchObject({ name: "标准税率", rate_bps: 1000, country_code: null });
      expect(data.country_rates).toHaveLength(2);
      expect(data.country_rates.map((r: { country_code: string }) => r.country_code).sort()).toEqual([
        "CN",
        "US",
      ]);
    });
  });

  it("删掉某国覆盖后回落默认（覆盖表里不再有它）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/tax/country-rates/CN",
        headers: adminJson,
        payload: { name: "中国增值税", rate_bps: 1300 },
      });
      const del = await app.inject({
        method: "DELETE",
        url: "/api/v1/admin/tax/country-rates/CN",
        headers: admin,
      });
      expect(del.statusCode).toBe(200);

      const res = await app.inject({ method: "GET", url: "/api/v1/admin/tax", headers: admin });
      expect(res.json().data.country_rates).toEqual([]);
    });
  });

  it("税率越界 10001 被拒；空税名被拒", async () => {
    await withApp(async (app) => {
      const tooHigh = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/tax/country-rates/CN",
        headers: adminJson,
        payload: { name: "中国增值税", rate_bps: 10001 },
      });
      expect(tooHigh.statusCode).toBe(400);

      const emptyName = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/tax/default-rate",
        headers: adminJson,
        payload: { name: "", rate_bps: 1300 },
      });
      expect(emptyName.statusCode).toBe(400);
    });
  });

  it("鉴权：匿名 401；staff 无 settings 权限 403", async () => {
    await withApp(async (app) => {
      const anon = await app.inject({ method: "GET", url: "/api/v1/admin/tax" });
      expect(anon.statusCode).toBe(401);

      const asStaff = await app.inject({
        method: "GET",
        url: "/api/v1/admin/tax",
        headers: { authorization: "Bearer staff" },
      });
      expect(asStaff.statusCode).toBe(403);
    });
  });
});
