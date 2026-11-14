import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 会员等级（ADR-102）。
 *
 * 守住三件事：
 *  1. 门槛唯一（两档同门槛，顾客算哪档没有答案）；
 *  2. 折扣上限 30%；
 *  3. 等级不落库到客户身上：按累计消费实时匹配。
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
const cust = { authorization: "Bearer customer", "content-type": "application/json" };

describe("会员等级（ADR-102）", () => {
  it("创建等级；门槛重复被拒；折扣超 30% 被拒", async () => {
    await withApp(async (app) => {
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/admin/member-levels",
        headers: admin,
        payload: { name: "普通会员", threshold_minor: 0, discount_bps: 100 },
      });
      expect(first.statusCode, first.body).toBe(201);

      const dup = await app.inject({
        method: "POST",
        url: "/api/v1/admin/member-levels",
        headers: admin,
        payload: { name: "重复门槛", threshold_minor: 0, discount_bps: 200 },
      });
      expect(dup.statusCode).toBe(400);

      const tooHigh = await app.inject({
        method: "POST",
        url: "/api/v1/admin/member-levels",
        headers: admin,
        payload: { name: "超标", threshold_minor: 100000, discount_bps: 3001 },
      });
      expect(tooHigh.statusCode).toBe(400);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/member-levels",
        headers: admin,
      });
      expect((list.json().data as { items: unknown[] }).items).toHaveLength(1);
    });
  });

  it("列表按门槛从低到高；可改折扣", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/member-levels",
        headers: admin,
        payload: { name: "金卡", threshold_minor: 500000, discount_bps: 500 },
      });
      const normal = await app.inject({
        method: "POST",
        url: "/api/v1/admin/member-levels",
        headers: admin,
        payload: { name: "普通", threshold_minor: 0, discount_bps: 100 },
      });
      const id = (normal.json().data as { id: string }).id;

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/member-levels",
        headers: admin,
      });
      const items = (list.json().data as { items: Array<{ name: string; threshold_minor: number }> }).items;
      expect(items.map((i) => i.name)).toEqual(["普通", "金卡"]);

      const updated = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/member-levels/${id}`,
        headers: admin,
        payload: { discount_bps: 300 },
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect((updated.json().data as { discount_bps: number }).discount_bps).toBe(300);
    });
  });

  it("我的等级：按累计消费匹配，并给出下一档差额", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/member-levels",
        headers: admin,
        payload: { name: "普通", threshold_minor: 0, discount_bps: 100 },
      });
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/member-levels",
        headers: admin,
        payload: { name: "银卡", threshold_minor: 20000, discount_bps: 500 },
      });
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/member-levels",
        headers: admin,
        payload: { name: "金卡", threshold_minor: 100000, discount_bps: 800 },
      });

      // 假订单汇总里 cust_1 累计消费 21400 元分（214 元）→ 银卡
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/member-level",
        headers: cust,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data as {
        level: { name: string; discount_bps: number } | null;
        spent_minor: number;
        next: { name: string; gap_minor: number } | null;
      };
      expect(data.level?.name).toBe("银卡");
      expect(data.level?.discount_bps).toBe(500);
      expect(data.spent_minor).toBe(21400);
      expect(data.next?.name).toBe("金卡");
      expect(data.next?.gap_minor).toBe(78600);
    });
  });

  it("未登录查我的等级 → 401", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/member-level" });
      expect(res.statusCode).toBe(401);
    });
  });
});
