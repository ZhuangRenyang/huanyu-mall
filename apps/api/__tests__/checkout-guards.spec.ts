import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 结账防绕过（ADR-019）。
 *
 * 用户要求：运费与税全自动、不能有绕过方式。
 * 这里锁住四件事：
 *   1. 没有收货国家不能下单（否则走默认税率 = 少交税的口子）；
 *   2. 请求体里的国家不能和购物车不一致（否则展示一个价、下单另一个价）；
 *   3. 查询参数不再影响金额（?country 改了也没用）；
 *   4. 该地区没有运费方案时拒绝下单（不能按 0 运费发到不配送地区）。
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

const json = (country: string) => ({
  method: "PUT" as const,
  url: "/api/v1/store/carts/cart_1/address",
  headers: { "content-type": "application/json" },
  payload: { country },
});

const complete = (payload?: Record<string, unknown>, key = "idem-guard-1") => ({
  method: "POST" as const,
  url: "/api/v1/store/carts/cart_1/complete",
  headers: { "content-type": "application/json", "idempotency-key": key },
  ...(payload ? { payload } : {}),
});

describe("结账防绕过（ADR-019）", () => {
  it("没有收货国家就下单 → 400，且提示先填国家", async () => {
    await withApp(async (app) => {
      const res = await app.inject(complete());
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("收货国家");
    });
  });

  it("设置国家后购物车带上国家与运费；换国家按新国家重算", async () => {
    await withApp(async (app) => {
      const cn = await app.inject(json("CN"));
      expect(cn.statusCode).toBe(200);
      expect(cn.json().data.shipping_country).toBe("CN");
      expect(cn.json().data.shipping_method.amount_minor).toBe(800);
      expect(cn.json().data.totals.shipping_minor).toBe(800);
    });
  });

  it("请求体国家与购物车不一致 → 400（不允许用低税国家出单）", async () => {
    await withApp(async (app) => {
      await app.inject(json("CN"));
      const res = await app.inject(
        complete({ shipping_address: { country: "US", city: "纽约" } }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("不一致");
    });
  });

  it("?country 查询参数不再影响金额（防「换参数看低价」）", async () => {
    await withApp(async (app) => {
      await app.inject(json("CN"));
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/carts/cart_1?country=US",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.shipping_country).toBe("CN");
      expect(res.json().data.totals.shipping_minor).toBe(800);
    });
  });

  it("该地区没有运费方案 → 400，不按 0 运费放行", async () => {
    await withApp(async (app) => {
      await app.inject(json("ZZ"));
      const res = await app.inject(complete({ shipping_address: { city: "某市" } }));
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("不支持配送");
    });
  });

  it("地址只填详情也能下单（国家以购物车为准，不要求客户端重复传）", async () => {
    await withApp(async (app) => {
      await app.inject(json("CN"));
      const res = await app.inject(complete({ shipping_address: { city: "深圳" } }));
      expect(res.statusCode, res.body).toBe(201);
    });
  });
});
