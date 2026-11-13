import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 店铺资料（ADR-045）：店名与客服电话。
 *
 * 改一次，店头 / 页脚 / 发货单三处同步 —— 之前店名写死在两个组件里、发货单没有店名。
 * 这里守：能写、能读回、店面 bootstrap 也带出去。
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

describe("店铺资料", () => {
  it("默认返回店名，客服电话为空", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const settings = res.json().data.settings;
      expect(settings.store_name).toBe("全球商城");
      expect(settings.support_phone).toBeNull();
    });
  });

  it("PATCH 保存后能读回；空串客服电话存为 null", async () => {
    await withApp(async (app) => {
      const patch = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: adminJson,
        payload: { store_name: "山海优选", support_phone: "" },
      });
      expect(patch.statusCode, patch.body).toBe(200);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.json().data.settings.store_name).toBe("山海优选");
      expect(res.json().data.settings.support_phone).toBeNull();
    });
  });

  it("店面 bootstrap 带出店名（店头与页脚都读它）", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: adminJson,
        payload: { store_name: "山海优选", support_phone: "400-800-1234" },
      });

      const res = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.theme.store_name).toBe("山海优选");
      expect(res.json().data.theme.support_phone).toBe("400-800-1234");
    });
  });

  it("店名留空被 schema 拒绝（不允许把店名改成空）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: adminJson,
        payload: { store_name: "" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("拼错的字段被拒，而不是静默落库（之前是全放开的 record）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: adminJson,
        payload: { store_nmae: "打错的名字" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("退货地址能存能读，空串存 null（顾客退货时看不到空白块）", async () => {
    await withApp(async (app) => {
      const addr = "收件人：张三\n电话：13800000000\n地址：广东省深圳市南山区科苑路 15 号 3 号仓";
      const patch = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: adminJson,
        payload: { return_address: addr },
      });
      expect(patch.statusCode, patch.body).toBe(200);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.json().data.settings.return_address).toBe(addr);

      // 清空：空串按「没配」处理，存 null（否则前台要判两种空）
      await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: adminJson,
        payload: { return_address: "   " },
      });
      const after = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings",
        headers: { authorization: "Bearer admin" },
      });
      expect(after.json().data.settings.return_address).toBeNull();
    });
  });

  it("拼错的键仍然 400（strict 未因新增退回地址而放松）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: adminJson,
        payload: { return_adress: "写错了" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
