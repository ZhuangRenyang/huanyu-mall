import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 购物车「失效宝贝」（ADR-062）。
 *
 * 商品下架或售罄后，购物车里那一行看起来仍是正常商品；
 * 顾客点结算才失败，而那时购物车已经关了，他看不到是哪件出了问题。
 *
 * 接口给每一行标出 `availability_status` 与 `available_quantity`，
 * 前端据此分组、禁止结算、一键移出。四种状态都要真的判得出来：
 * ok / insufficient / out_of_stock / delisted。
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

/** 读购物车并返回第一行。 */
async function firstLine(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({ method: "GET", url: "/api/v1/store/carts/cart_1" });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data.line_items[0] as {
    variant_id: string;
    availability_status: string;
    available_quantity: number;
  };
}

describe("购物车失效判定", () => {
  it("有货且够买 → ok，并带出可用量", async () => {
    await withApp(async (app) => {
      const line = await firstLine(app);
      expect(line.variant_id).toBe("var_1");
      expect(line.availability_status).toBe("ok");
      expect(line.available_quantity).toBe(12);
    });
  });

  it("售罄 → out_of_stock", async () => {
    await withApp(async (app, deps) => {
      deps.state.variantAvailable = 0;
      const line = await firstLine(app);
      expect(line.availability_status).toBe("out_of_stock");
      expect(line.available_quantity).toBe(0);
    });
  });

  it("商品已下架 → delisted（即使库存还有货也买不了）", async () => {
    await withApp(async (app, deps) => {
      // 可用量仍是 12：只看库存会误判为正常
      deps.state.unpurchasableVariantIds = ["var_1"];
      const line = await firstLine(app);
      expect(line.availability_status).toBe("delisted");
      expect(line.available_quantity).toBe(12);
    });
  });

  it("数量超过库存 → insufficient（商品还能买，只是要改小）", async () => {
    await withApp(async (app, deps) => {
      deps.state.cartLineQuantity = 3;
      deps.state.variantAvailable = 2;
      const line = await firstLine(app);
      expect(line.availability_status).toBe("insufficient");
      expect(line.available_quantity).toBe(2);
    });
  });

  it("刚好够买不算不足（边界）", async () => {
    await withApp(async (app, deps) => {
      deps.state.cartLineQuantity = 2;
      deps.state.variantAvailable = 2;
      const line = await firstLine(app);
      expect(line.availability_status).toBe("ok");
    });
  });
});
