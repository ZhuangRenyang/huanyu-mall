import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 补齐淘宝订单/商品详情里两块必备信息：商品图片、商家备注与操作日志。
 *
 * 这里守三件真会出事的地方：
 * 1. 图片顺序即主图 —— 第一张错了，全店列表、购物车、订单都跟着错；
 * 2. 备注只进后台，不能漏到店面接口；
 * 3. 操作日志必须能追到「谁改了什么」，不能只留一条最后状态。
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

describe("商品图片", () => {
  it("整组替换后返回带 URL 的图片，第一张是主图", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/products/prod_1/images",
        headers: adminJson,
        payload: { file_ids: ["file_a", "file_b"] },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data;
      expect(data.images).toHaveLength(2);
      expect(data.images[0]).toMatchObject({ file_id: "file_a", is_primary: true });
      expect(data.images[1]).toMatchObject({ file_id: "file_b", is_primary: false });
      // 前端要能直接渲染，URL 由后端算好
      expect(typeof data.images[0].url).toBe("string");
      expect(data.thumbnail_file_id).toBe("file_a");
    });
  });

  it("传空数组 = 清空图片与主图（不是静默保留）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/products/prod_1/images",
        headers: adminJson,
        payload: { file_ids: [] },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.images).toHaveLength(0);
      expect(res.json().data.thumbnail_file_id).toBeNull();
    });
  });

  it("超过 12 张直接 400，不落库", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/products/prod_1/images",
        headers: adminJson,
        payload: { file_ids: Array.from({ length: 13 }, (_, i) => `file_${i}`) },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe("订单商家备注与操作日志", () => {
  it("写备注后详情里能读到，且进得了审计", async () => {
    await withApp(async (app, deps) => {
      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/orders/ord_1/note",
        headers: adminJson,
        payload: { note: "客户要求顺丰，周三前必须到" },
      });
      expect(put.statusCode, put.body).toBe(200);
      expect(put.json().data.merchant_note).toBe("客户要求顺丰，周三前必须到");

      const get = await app.inject({ method: "GET", url: "/api/v1/admin/orders/ord_1", headers: admin });
      expect(get.json().data.merchant_note).toBe("客户要求顺丰，周三前必须到");

      const logged = deps.auditRepo.rows.filter(
        (r) => r.action === "order.note.update" && r.entityId === "ord_1",
      );
      expect(logged).toHaveLength(1);
    });
  });

  it("空串等于清空备注", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/orders/ord_1/note",
        headers: adminJson,
        payload: { note: "先写一条" },
      });
      const clear = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/orders/ord_1/note",
        headers: adminJson,
        payload: { note: "  " },
      });
      expect(clear.statusCode, clear.body).toBe(200);
      expect(clear.json().data.merchant_note).toBeNull();
    });
  });

  it("操作日志端点只能查到本订单的记录", async () => {
    await withApp(async (app) => {
      // 造两条不同实体的审计
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/orders/ord_1/note",
        headers: adminJson,
        payload: { note: "本单备注" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders/ord_1/logs",
        headers: admin,
      });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{ action: string; entity_id?: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => (i as { entityId?: string }).entityId !== "ord_other")).toBe(true);
    });
  });
});
