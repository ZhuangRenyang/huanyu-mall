import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 运费设置后台接口（ADR-019）。
 *
 * 这层只验「薄壳」：权限、入参校验、领域错误是否原样透出。
 * 真正的守卫（国家唯一归属、满额门槛、删区保护）在模块单测里守着——
 * 这里不复刻规则，否则就是第二套实现，改一处漏一处。
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
const adminJson = { ...admin, "content-type": "application/json" };

describe("运费设置后台接口", () => {
  it("未登录不可读运费配置", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/shipping" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("一次返回：区、区内方式、可选国家、币种", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/shipping", headers: admin });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(Array.isArray(data.zones)).toBe(true);
      expect(data.zones.length).toBeGreaterThan(0);
      expect(data.zones[0].options.length).toBeGreaterThan(0);
      expect(data.currency_code).toBe("CNY");
      expect(data.countries.length).toBeGreaterThan(0);
      // 商家不该看到 shipping_option_channel 这种实现细节
      expect(JSON.stringify(data)).not.toContain("shipping_option_channel");
    });
  });

  it("建区 + 建运费方式，能被下一次读取看到", async () => {
    await withApp(async (app) => {
      const zoneRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/shipping/zones",
        headers: adminJson,
        payload: { name: "东南亚", country_codes: ["ID", "PH"] },
      });
      expect(zoneRes.statusCode, zoneRes.body).toBe(200);
      const zoneId = zoneRes.json().data.id as string;

      const optRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/shipping/options",
        headers: adminJson,
        payload: {
          zone_id: zoneId,
          name: "满 199 包邮",
          type: "free_over",
          amount_minor: 1500,
          free_over_threshold_minor: 19900,
        },
      });
      expect(optRes.statusCode, optRes.body).toBe(200);
      expect(optRes.json().data.free_over_threshold_minor).toBe(19900);

      const list = await app.inject({ method: "GET", url: "/api/v1/admin/shipping", headers: admin });
      const zone = (list.json().data.zones as Array<{ id: string; options: unknown[] }>).find(
        (z) => z.id === zoneId,
      );
      expect(zone?.options).toHaveLength(1);
    });
  });

  it("同一国家重复进区 → 409，且提示哪个区已占用", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/shipping/zones",
        headers: adminJson,
        payload: { name: "重复区", country_codes: ["CN"] },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toContain("CN");
    });
  });

  it("满额包邮不填门槛 → 400（不是静默存成全场包邮）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/shipping/options",
        headers: adminJson,
        payload: {
          zone_id: "zone_default",
          name: "满额包邮",
          type: "free_over",
          amount_minor: 800,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("区内仍有运费方式时删区 → 409", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/v1/admin/shipping/zones/zone_default",
        headers: admin,
      });
      expect(res.statusCode).toBe(409);
    });
  });

  it("国家码不是两位字母 → 400（挡住手打错值）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/shipping/zones",
        headers: adminJson,
        payload: { name: "错区", country_codes: ["CHINA"] },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
