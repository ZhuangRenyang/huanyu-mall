import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 本商品可用券（ADR-071）。
 *
 * 商品页领券区原来把全店公开券直接铺开：顾客在 B 商品页领了一张「限 A 商品」的券，
 * 结账时才发现用不了。这里守两条：
 * 1. 整单券 / 运费券都算「本商品可用」；
 * 2. 指定商品券只有命中本商品的才出现，命中别的商品的不出现。
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

/** 建一张公开券，返回 id。`scopes` 传了就建成指定商品券。 */
async function seedVoucher(
  app: Awaited<ReturnType<typeof buildApp>>,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/promotions/vouchers",
    headers: adminJson,
    payload: { discount_type: "fixed", discount_value: 1000, is_public: true, ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data.id as string;
}

describe("本商品可用券（ADR-071）", () => {
  it("整单券与命中本商品的券都返回，命中别的商品的不返回", async () => {
    await withApp(async (app, deps) => {
      await deps.services.promotion.setFeatureEnabled("voucher", true);
      const entire = await seedVoucher(app, { name: "整单券" });
      const mine = await seedVoucher(app, {
        name: "限本商品",
        type: "specific_product",
        scopes: [{ scope_type: "product", scope_id: "prod_1" }],
      });
      const other = await seedVoucher(app, {
        name: "限别的商品",
        type: "specific_product",
        scopes: [{ scope_type: "product", scope_id: "prod_9" }],
      });

      const res = await app.inject({ method: "GET", url: "/api/v1/store/products/tee/vouchers" });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data as { items: Array<{ id: string }>; currency_code: string };
      const ids = data.items.map((v) => v.id);
      expect(ids).toContain(entire);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(other);
      expect(data.currency_code).toBeTruthy();
    });
  });

  it("匿名可读：未登录也能拿到券条（领取时才要登录）", async () => {
    await withApp(async (app, deps) => {
      await deps.services.promotion.setFeatureEnabled("voucher", true);
      const id = await seedVoucher(app, { name: "匿名可见券" });
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products/tee/vouchers" });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json().data.items as Array<{ id: string }>).map((v) => v.id)).toContain(id);
    });
  });

  it("商品不存在 → 404（不返回空列表冒充「这个商品没券」）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products/nope/vouchers" });
      expect(res.statusCode).toBe(404);
    });
  });
});
