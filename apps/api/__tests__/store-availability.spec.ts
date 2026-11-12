import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 店面商品列表的可用量（ADR-041）。
 *
 * 只验薄壳：列表接口把「变体可用量之和」带出来，让卡片能标「已售罄」。
 * 库存与预留的完整规则在 inventory 模块单测里守着。
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

describe("商品列表带可用量（ADR-041）", () => {
  it("每个商品返回 available_quantity（各变体可用量之和）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products" });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{ available_quantity?: number }>;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(typeof item.available_quantity).toBe("number");
        expect(item.available_quantity).toBeGreaterThan(0);
      }
    });
  });

  it("全部变体无库存时 available_quantity = 0（前端据此标已售罄）", async () => {
    await withApp(async (app, deps) => {
      deps.state.variantAvailable = 0;
      const res = await app.inject({ method: "GET", url: "/api/v1/store/products" });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{ available_quantity?: number }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.available_quantity === 0)).toBe(true);
    });
  });
});
