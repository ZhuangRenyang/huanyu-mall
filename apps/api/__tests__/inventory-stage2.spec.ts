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
const staff = { authorization: "Bearer staff" };
const adminJson = { ...admin, "content-type": "application/json" };
const staffJson = { ...staff, "content-type": "application/json" };

describe("多仓后台接口（ADR-013 阶段 2：仓库 / 按仓库存 / 调拨）", () => {
  it("仓库列表：admin 与 staff（有 inventory 权限）均可读，含 priority", async () => {
    await withApp(async (app) => {
      const asAdmin = await app.inject({ method: "GET", url: "/api/v1/admin/stock-locations", headers: admin });
      expect(asAdmin.statusCode).toBe(200);
      expect(asAdmin.json().data.items.map((l: { id: string }) => l.id)).toEqual(["loc_1", "loc_2"]);
      expect(asAdmin.json().data.items[0].priority).toBe(10);

      const asStaff = await app.inject({ method: "GET", url: "/api/v1/admin/stock-locations", headers: staff });
      expect(asStaff.statusCode).toBe(200);
    });
  });

  it("建仓 201 + 审计 stock_location.create；改仓 200 + 审计 stock_location.update", async () => {
    await withApp(async (app, deps) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/stock-locations",
        headers: adminJson,
        payload: { name: "C 仓", priority: 5 },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().data).toMatchObject({ name: "C 仓", priority: 5 });

      const patched = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/stock-locations/loc_2",
        headers: adminJson,
        payload: { priority: 99 },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().data.priority).toBe(99);

      const actions = deps.auditRepo.rows.map((r) => r.action);
      expect(actions).toContain("stock_location.create");
      expect(actions).toContain("stock_location.update");
    });
  });

  it("按仓库存行：location_id 过滤，返回 sku 与三项数量", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/inventory-levels?location_id=loc_2&limit=20&offset=0",
        headers: admin,
      });
      expect(res.statusCode).toBe(200);
      const row = res.json().data.items[0];
      expect(row.stock_location_id).toBe("loc_2");
      expect(row.sku).toBe("SKU-1");
      expect(row.stocked_quantity).toBe(10);
      expect(row.available_quantity).toBe(10);
    });
  });

  it("调拨全流程：创建 201 → 完成 200 → 列表可按状态过滤，写三条审计", async () => {
    await withApp(async (app, deps) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/inventory-transfers",
        headers: staffJson,
        payload: {
          inventory_item_id: "invitem_1",
          from_location_id: "loc_1",
          to_location_id: "loc_2",
          quantity: 3,
          note: "补货",
        },
      });
      expect(created.statusCode).toBe(201);
      const transfer = created.json().data;
      expect(transfer.status).toBe("pending");

      const completed = await app.inject({
        method: "POST",
        url: `/api/v1/admin/inventory-transfers/${transfer.id}/complete`,
        headers: staff,
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json().data.status).toBe("completed");

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/inventory-transfers?status=completed",
        headers: admin,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.items).toHaveLength(1);
      expect(list.json().data.count).toBe(1);

      const actions = deps.auditRepo.rows.map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "inventory_transfer.create",
          "inventory_transfer.complete",
        ]),
      );
    });
  });

  it("调拨取消：pending → cancelled，库存动作记为 cancel", async () => {
    await withApp(async (app, deps) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/inventory-transfers",
        headers: adminJson,
        payload: {
          inventory_item_id: "invitem_1",
          from_location_id: "loc_1",
          to_location_id: "loc_2",
          quantity: 1,
        },
      });
      const id = created.json().data.id;
      const cancelled = await app.inject({
        method: "POST",
        url: `/api/v1/admin/inventory-transfers/${id}/cancel`,
        headers: admin,
      });
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json().data.status).toBe("cancelled");
      expect(deps.auditRepo.rows.map((r) => r.action)).toContain("inventory_transfer.cancel");
    });
  });

  it("参数校验：调拨数量必须正整数 / 列表 status 非法 → 400", async () => {
    await withApp(async (app) => {
      const zero = await app.inject({
        method: "POST",
        url: "/api/v1/admin/inventory-transfers",
        headers: adminJson,
        payload: {
          inventory_item_id: "invitem_1",
          from_location_id: "loc_1",
          to_location_id: "loc_2",
          quantity: 0,
        },
      });
      expect(zero.statusCode).toBe(400);
      expect(zero.json().code).toBe(20001);

      const badStatus = await app.inject({
        method: "GET",
        url: "/api/v1/admin/inventory-transfers?status=oops",
        headers: admin,
      });
      expect(badStatus.statusCode).toBe(400);
    });
  });

  it("RBAC：staff 无 settings（403），admin 全通（200）", async () => {
    await withApp(async (app) => {
      const staffSettings = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings",
        headers: staff,
      });
      expect(staffSettings.statusCode).toBe(403);

      const adminSettings = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings",
        headers: admin,
      });
      expect(adminSettings.statusCode).toBe(200);
    });
  });

  it("订单预留明细 GET /orders/:id/reservations 返回仓与数量", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders/ord_1/reservations",
        headers: admin,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.count).toBe(1);
      expect(res.json().data.items[0]).toMatchObject({
        id: "rsv_1",
        stock_location_id: "loc_1",
        quantity: 1,
        inventory_item_id: "invitem_1",
      });
    });
  });

  it("发货单透传 stock_location_id（一张发货单一个仓）", async () => {
    await withApp(async (app, deps) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/orders/ord_1/fulfillments",
        headers: adminJson,
        payload: {
          items: [{ order_line_item_id: "oli_1", quantity: 1 }],
          stock_location_id: "loc_2",
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.stock_location_id).toBe("loc_2");
      expect(deps.auditRepo.rows.map((r) => r.action)).toContain("fulfillment.create");
    });
  });

  it("订单发货单查询：返回已发仓与运单，供后台看「还差哪个仓」", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/orders/ord_1/fulfillments",
        headers: admin,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.count).toBe(1);
      expect(res.json().data.items[0]).toMatchObject({
        id: "fulf_1",
        stock_location_id: "loc_1",
        status: "shipped",
        tracking_links: [{ carrier: "顺丰", number: "SF1" }],
      });

      // staff 无 orders 权限（staff 权限为 products/orders/... —— orders 有，故 200）；
      // 用匿名验证鉴权边界
      const anon = await app.inject({ method: "GET", url: "/api/v1/admin/orders/ord_1/fulfillments" });
      expect(anon.statusCode).toBe(401);
    });
  });
});

describe("营销功能开关（默认全关，ADR-014）", () => {
  it("后台读/写开关 + 审计；店面只读；未知功能 400", async () => {
    const { buildApp } = await import("../src/app.js");
    const { createFakeClock, createFakeRateLimit, makeDeps } = await import("./helpers/fake-deps.js");
    const deps = makeDeps();
    const fake = createFakeRateLimit(createFakeClock());
    const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
    const adminJson = { authorization: "Bearer admin", "content-type": "application/json" };
    try {
      // 默认全关
      const initial = await app.inject({ method: "GET", url: "/api/v1/admin/promotions/features", headers: adminJson });
      expect(initial.statusCode).toBe(200);
      expect(initial.json().data).toEqual({ promotion: false, voucher: false, gift_card: false });

      // 打开促销
      const on = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/promotions/features/promotion",
        headers: adminJson,
        payload: { enabled: true },
      });
      expect(on.statusCode).toBe(200);
      expect(on.json().data.promotion).toBe(true);
      expect(deps.auditRepo.rows.some((r) => r.action === "promotion.feature.update")).toBe(true);

      // 店面只读，值与后台一致
      const store = await app.inject({ method: "GET", url: "/api/v1/store/promotions/features" });
      expect(store.statusCode).toBe(200);
      expect(store.json().data.promotion).toBe(true);
      expect(store.json().data.voucher).toBe(false);

      // 未知功能名 400
      const bad = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/promotions/features/seckill",
        headers: adminJson,
        payload: { enabled: true },
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
