import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 商品销量「已售 N 件」（ADR-067）。
 *
 * 淘宝商品卡与商品页都有月销/已售，是社交证明。销量口径必须真实：
 * 只数「已成交」的订单行（已付款/已发货/已收货/已完成），未付款、取消、退款都不算。
 * 这里只验接口薄壳：列表与详情都带出 sold_count（商品级 = 各变体之和）。
 * 口径本身（哪些状态算成交）由 order 模块的 countSoldByVariantIds 守。
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

describe("商品销量（ADR-067）", () => {
  it("列表带 sold_count，默认 0", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products" });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{ sold_count?: number }>;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(typeof item.sold_count).toBe("number");
      }
    });
  });

  it("详情带商品级 sold_count（各变体之和）与每变体 sold_count", async () => {
    await withApp(async (app, deps) => {
      deps.state.soldByVariant = { var_1: 42 };
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products/tee" });
      expect(res.statusCode, res.body).toBe(200);
      const detail = res.json().data as {
        sold_count?: number;
        variants?: Array<{ id: string; sold_count?: number }>;
      };
      expect(detail.sold_count).toBe(42);
      expect(detail.variants?.[0]?.sold_count).toBe(42);
    });
  });

  it("销量来自 order 服务，未成交的订单不算（接口只透传，口径在模块侧）", async () => {
    await withApp(async (app, deps) => {
      // 只给 var_1 配了销量，其余变体应该是 0
      deps.state.soldByVariant = { var_1: 7 };
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products/tee" });
      const detail = res.json().data as { sold_count?: number; variants?: Array<{ id: string; sold_count?: number }> };
      expect(detail.sold_count).toBe(7);
      // 没有销量的变体显示 0 而不是 undefined（前端不用再判空）
      for (const v of detail.variants ?? []) {
        expect(typeof v.sold_count).toBe("number");
      }
    });
  });
});

describe("商品销量排序（ADR-068）", () => {
  it("?sort=sold_count.desc 被接受，返回 200 且带 sold_count", async () => {
    await withApp(async (app, deps) => {
      deps.state.soldByVariant = { var_1: 42 };
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/products?sort=sold_count.desc",
      });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{ sold_count?: number }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.sold_count).toBe(42);
    });
  });
});
