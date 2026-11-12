import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 店面领券（ADR-029）。
 *
 * 只验薄壳：匿名可读券列表、领取要登录、领取后卡券包里能查到。
 * 「限领 / 幂等 / 核销联动」在 promotion 模块单测里守着。
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
const customer = { authorization: "Bearer customer" };

/** 打开营销开关后建一张公开券，返回 id（开关关着时券条不会露出）。 */
async function seedPublicVoucher(
  app: Awaited<ReturnType<typeof buildApp>>,
  deps: ReturnType<typeof makeDeps>,
): Promise<string> {
  await deps.services.promotion.setFeatureEnabled('voucher', true);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/promotions/vouchers",
    headers: adminJson,
    payload: {
      name: "满 199 减 20",
      discount_type: "fixed",
      discount_value: 2000,
      min_spent: 19900,
      is_public: true,
      collect_limit: 1,
    },
  });
  return res.json().data.id as string;
}

describe("店面领券", () => {
  it("券列表匿名可读（商品页券条不需要登录）", async () => {
    await withApp(async (app, deps) => {
      const id = await seedPublicVoucher(app, deps);
      const res = await app.inject({ method: "GET", url: "/api/v1/store/vouchers" });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.currency_code).toBeTruthy();
      expect((data.items as Array<{ id: string }>).some((v) => v.id === id)).toBe(true);
    });
  });

  it("未公开的券不出现在店面列表里", async () => {
    await withApp(async (app, deps) => {
      await deps.services.promotion.setFeatureEnabled('voucher', true);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/promotions/vouchers",
        headers: adminJson,
        payload: { name: "内部券", discount_type: "fixed", discount_value: 1000 },
      });
      const internalId = res.json().data.id as string;

      const list = await app.inject({ method: "GET", url: "/api/v1/store/vouchers" });
      const items = list.json().data.items as Array<{ id: string }>;
      expect(items.some((v) => v.id === internalId)).toBe(false);
    });
  });

  it("领取必须登录 → 401", async () => {
    await withApp(async (app, deps) => {
      const id = await seedPublicVoucher(app, deps);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/store/vouchers/${id}/collect`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  it("领取成功返回券码，重复领取幂等返回同一个码", async () => {
    await withApp(async (app, deps) => {
      const id = await seedPublicVoucher(app, deps);

      const first = await app.inject({
        method: "POST",
        url: `/api/v1/store/vouchers/${id}/collect`,
        headers: customer,
      });
      expect(first.statusCode, first.body).toBe(200);
      const code = first.json().data.code as string;
      expect(code).toBeTruthy();
      expect(first.json().data.already_collected).toBe(false);

      const again = await app.inject({
        method: "POST",
        url: `/api/v1/store/vouchers/${id}/collect`,
        headers: customer,
      });
      expect(again.json().data.code).toBe(code);
      expect(again.json().data.already_collected).toBe(true);
    });
  });

  it("领取后能在「我的卡券」里查到，且列表标记为已领", async () => {
    await withApp(async (app, deps) => {
      const id = await seedPublicVoucher(app, deps);
      await app.inject({
        method: "POST",
        url: `/api/v1/store/vouchers/${id}/collect`,
        headers: customer,
      });

      const mine = await app.inject({
        method: "GET",
        url: "/api/v1/store/customer/vouchers",
        headers: customer,
      });
      expect(mine.statusCode, mine.body).toBe(200);
      const items = mine.json().data.items as Array<{ voucher_id: string; status: string }>;
      expect(items.some((v) => v.voucher_id === id && v.status === "unused")).toBe(true);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/store/vouchers",
        headers: customer,
      });
      const target = (list.json().data.items as Array<{ id: string; collected: boolean }>).find(
        (v) => v.id === id,
      );
      expect(target?.collected).toBe(true);
    });
  });

  it("我的卡券未登录 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/customer/vouchers" });
      expect(res.statusCode).toBe(401);
    });
  });
});
