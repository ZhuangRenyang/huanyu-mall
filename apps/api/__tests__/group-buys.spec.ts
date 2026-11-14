import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 拼团（ADR-100）：参团免费、成团领券。
 *
 * 守住四件事：
 *  1. 建出来是草稿，上架后店面才可见；
 *  2. 参团要登录，一人一活动只有一个团；
 *  3. 满员即成团，成团后才可领券（未成团领券报 409）；
 *  4. 拼团价必须低于原价（填错就是资损）。
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
const cust1 = { authorization: "Bearer customer", "content-type": "application/json" };
/** 第二个顾客：换一个 token（假鉴权按 token 前缀识别）。 */
const cust2 = { authorization: "Bearer customer2", "content-type": "application/json" };

function activityBody(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    name: "三人成团",
    variant_id: "var_1",
    title: "测试商品 · 黑色",
    original_price_minor: 10000,
    group_price_minor: 7000,
    team_size: 2,
    starts_at: new Date(now - 60_000).toISOString(),
    ends_at: new Date(now + 86_400_000).toISOString(),
    ...over,
  };
}

describe("拼团（ADR-100）", () => {
  it("创建 → 草稿；上架后店面可见", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/group-buys",
        headers: admin,
        payload: activityBody(),
      });
      expect(created.statusCode, created.body).toBe(201);
      const activity = created.json().data as { id: string; status: string; voucher_id: string };
      expect(activity.status).toBe("draft");
      // 创建活动同时自动建券
      expect(activity.voucher_id).toBeTruthy();

      const before = await app.inject({ method: "GET", url: "/api/v1/store/group-buys" });
      expect((before.json().data as { items: unknown[] }).items).toHaveLength(0);

      const activated = await app.inject({
        method: "POST",
        url: `/api/v1/admin/group-buys/${activity.id}/status`,
        headers: admin,
        payload: { status: "active" },
      });
      expect(activated.statusCode, activated.body).toBe(200);

      const after = await app.inject({ method: "GET", url: "/api/v1/store/group-buys" });
      expect((after.json().data as { items: unknown[] }).items).toHaveLength(1);
    });
  });

  it("参团要登录；两人满员成团；重复参团返回原团", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/group-buys",
        headers: admin,
        payload: activityBody(),
      });
      const id = (created.json().data as { id: string }).id;
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/group-buys/${id}/status`,
        headers: admin,
        payload: { status: "active" },
      });

      // 未登录 → 401
      const anonymous = await app.inject({
        method: "POST",
        url: `/api/v1/store/group-buys/${id}/join`,
      });
      expect(anonymous.statusCode).toBe(401);

      // 团长开团
      const first = await app.inject({
        method: "POST",
        url: `/api/v1/store/group-buys/${id}/join`,
        headers: cust1,
      });
      expect(first.statusCode, first.body).toBe(200);
      const team1 = first.json().data as { team: { id: string; member_count: number; status: string }; joined: boolean };
      expect(team1.joined).toBe(true);
      expect(team1.team.member_count).toBe(1);
      expect(team1.team.status).toBe("forming");

      // 第二人补进同一个团，满员成团
      const second = await app.inject({
        method: "POST",
        url: `/api/v1/store/group-buys/${id}/join`,
        headers: cust2,
      });
      const team2 = second.json().data as { team: { id: string; member_count: number; status: string } };
      expect(team2.team.id).toBe(team1.team.id);
      expect(team2.team.member_count).toBe(2);
      expect(team2.team.status).toBe("success");

      // 重复参团：返回原团，不重复占名额
      const again = await app.inject({
        method: "POST",
        url: `/api/v1/store/group-buys/${id}/join`,
        headers: cust1,
      });
      const team3 = again.json().data as { joined: boolean; team: { member_count: number } };
      expect(team3.joined).toBe(false);
      expect(team3.team.member_count).toBe(2);
    });
  });

  it("成团才能领券；重复领返回同一张码", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/group-buys",
        headers: admin,
        payload: activityBody({ team_size: 3 }),
      });
      const id = (created.json().data as { id: string }).id;
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/group-buys/${id}/status`,
        headers: admin,
        payload: { status: "active" },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/store/group-buys/${id}/join`,
        headers: cust1,
      });

      // 3 人团只有 1 人：还不能领
      const tooEarly = await app.inject({
        method: "POST",
        url: `/api/v1/store/group-buys/${id}/voucher`,
        headers: cust1,
      });
      expect(tooEarly.statusCode).toBe(409);

      // 凑满 3 人
      await app.inject({ method: "POST", url: `/api/v1/store/group-buys/${id}/join`, headers: cust2 });
      const cust3 = { authorization: "Bearer customer3", "content-type": "application/json" };
      await app.inject({ method: "POST", url: `/api/v1/store/group-buys/${id}/join`, headers: cust3 });

      const claim = await app.inject({
        method: "POST",
        url: `/api/v1/store/group-buys/${id}/voucher`,
        headers: cust1,
      });
      expect(claim.statusCode, claim.body).toBe(200);
      const first = claim.json().data as { code: string; already_collected: boolean };
      expect(first.code).toBeTruthy();
      expect(first.already_collected).toBe(false);

      const twice = await app.inject({
        method: "POST",
        url: `/api/v1/store/group-buys/${id}/voucher`,
        headers: cust1,
      });
      const second = twice.json().data as { code: string; already_collected: boolean };
      expect(second.code).toBe(first.code);
      expect(second.already_collected).toBe(true);
    });
  });

  it("拼团价不低于原价 → 400", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/group-buys",
        headers: admin,
        payload: activityBody({ group_price_minor: 10000 }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("我的拼团：能看到活动与团状态", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/group-buys",
        headers: admin,
        payload: activityBody(),
      });
      const id = (created.json().data as { id: string }).id;
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/group-buys/${id}/status`,
        headers: admin,
        payload: { status: "active" },
      });
      await app.inject({ method: "POST", url: `/api/v1/store/group-buys/${id}/join`, headers: cust1 });

      const mine = await app.inject({
        method: "GET",
        url: "/api/v1/store/group-buys/mine",
        headers: cust1,
      });
      expect(mine.statusCode, mine.body).toBe(200);
      const items = (mine.json().data as { items: Array<{ group_buy: { id: string }; team: { member_count: number } }> }).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.group_buy.id).toBe(id);
      expect(items[0]!.team.member_count).toBe(1);
    });
  });
});
