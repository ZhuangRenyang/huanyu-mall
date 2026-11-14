import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 限时秒杀（ADR-099）。
 *
 * 守住三件事：
 *  1. 建出来是**草稿**，不手动上架不生效；
 *  2. 秒杀价必须低于原价（填错就是资损，接口层就要挡住）；
 *  3. 结束后不能再上架（重新上架要新建活动）。
 */
async function withApp(fn: (app: Awaited<ReturnType<typeof buildApp>>, deps: any) => Promise<void>) {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

const admin = { authorization: "Bearer admin", "content-type": "application/json" };

/** 一个合法活动：原价 100 元，秒杀 60 元，放 10 件。 */
function saleBody(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    name: "周末限时秒杀",
    starts_at: new Date(now - 60_000).toISOString(),
    ends_at: new Date(now + 86_400_000).toISOString(),
    items: [
      {
        variant_id: "var_1",
        title: "测试商品 · 黑色",
        original_price_minor: 10000,
        flash_price_minor: 6000,
        stock: 10,
      },
    ],
    ...over,
  };
}

describe("限时秒杀（ADR-099）", () => {
  it("创建 → 草稿；上架后店面可见", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/flash-sales",
        headers: admin,
        payload: saleBody(),
      });
      expect(created.statusCode, created.body).toBe(201);
      const sale = created.json().data as { id: string; status: string; items: Array<{ flash_price_minor: number; remaining: number }> };
      expect(sale.status).toBe("draft");
      expect(sale.items).toHaveLength(1);
      expect(sale.items[0]!.flash_price_minor).toBe(6000);
      expect(sale.items[0]!.remaining).toBe(10);

      // 草稿阶段店面看不到
      const before = await app.inject({ method: "GET", url: "/api/v1/store/flash-sales" });
      expect((before.json().data as { items: unknown[] }).items).toHaveLength(0);

      // 上架
      const activated = await app.inject({
        method: "POST",
        url: `/api/v1/admin/flash-sales/${sale.id}/status`,
        headers: admin,
        payload: { status: "active" },
      });
      expect(activated.statusCode, activated.body).toBe(200);
      expect((activated.json().data as { status: string }).status).toBe("active");

      // 店面可见
      const after = await app.inject({ method: "GET", url: "/api/v1/store/flash-sales" });
      const list = after.json().data as { items: Array<{ id: string; items: unknown[] }> };
      expect(list.items).toHaveLength(1);
      expect(list.items[0]!.id).toBe(sale.id);
    });
  });

  it("秒杀价不低于原价 → 400（填错就是资损）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/flash-sales",
        headers: admin,
        payload: saleBody({
          items: [
            {
              variant_id: "var_1",
              title: "测试商品",
              original_price_minor: 10000,
              flash_price_minor: 10000,
              stock: 5,
            },
          ],
        }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("活动库存必须为正整数", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/flash-sales",
        headers: admin,
        payload: saleBody({
          items: [
            {
              variant_id: "var_1",
              title: "测试商品",
              original_price_minor: 10000,
              flash_price_minor: 6000,
              stock: 0,
            },
          ],
        }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("结束后不能再上架：重新开卖要新建活动", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/flash-sales",
        headers: admin,
        payload: saleBody(),
      });
      const id = (created.json().data as { id: string }).id;

      await app.inject({
        method: "POST",
        url: `/api/v1/admin/flash-sales/${id}/status`,
        headers: admin,
        payload: { status: "active" },
      });
      const ended = await app.inject({
        method: "POST",
        url: `/api/v1/admin/flash-sales/${id}/status`,
        headers: admin,
        payload: { status: "ended" },
      });
      expect(ended.statusCode).toBe(200);

      const reopen = await app.inject({
        method: "POST",
        url: `/api/v1/admin/flash-sales/${id}/status`,
        headers: admin,
        payload: { status: "active" },
      });
      expect(reopen.statusCode).toBe(409);
    });
  });

  it("没有 settings 权限的 staff 不能建活动", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/flash-sales",
        headers: { authorization: "Bearer staff_limited", "content-type": "application/json" },
        payload: saleBody(),
      });
      expect([401, 403]).toContain(res.statusCode);
    });
  });
});
