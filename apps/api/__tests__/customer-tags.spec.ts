import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 会员标签（ADR-103）。
 *
 * 守住三件事：
 *  1. 标签名唯一（重名标签在筛选时无法区分）；
 *  2. 打标是「覆盖式」：传什么就是什么，重复打标幂等；
 *  3. 删标签同时清关联（分页与计数都靠关联表，留孤儿行会让筛选错乱）。
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

describe("会员标签（ADR-103）", () => {
  it("创建标签；重名被拒；列表带客户数", async () => {
    await withApp(async (app) => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/customer-tags",
        headers: admin,
        payload: { name: "高价值" },
      });
      expect(created.statusCode, created.body).toBe(201);

      const dup = await app.inject({
        method: "POST",
        url: "/api/v1/admin/customer-tags",
        headers: admin,
        payload: { name: "高价值" },
      });
      expect(dup.statusCode).toBe(400);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/customer-tags",
        headers: admin,
      });
      const items = (list.json().data as { items: Array<{ name: string; customer_count: number }> }).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe("高价值");
      expect(items[0]!.customer_count).toBe(0);
    });
  });

  it("打标：覆盖式、幂等；客户列表能看到标签", async () => {
    await withApp(async (app) => {
      const t1 = await app.inject({
        method: "POST",
        url: "/api/v1/admin/customer-tags",
        headers: admin,
        payload: { name: "高价值" },
      });
      const t2 = await app.inject({
        method: "POST",
        url: "/api/v1/admin/customer-tags",
        headers: admin,
        payload: { name: "待回购" },
      });
      const id1 = (t1.json().data as { id: string }).id;
      const id2 = (t2.json().data as { id: string }).id;

      // 打两个标签（其中 id1 重复传一次，验证去重）
      const set = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/customers/cust_1/tags",
        headers: admin,
        payload: { tag_ids: [id1, id2, id1] },
      });
      expect(set.statusCode, set.body).toBe(200);
      expect((set.json().data as { items: unknown[] }).items).toHaveLength(2);

      // 覆盖式：只留一个
      const replace = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/customers/cust_1/tags",
        headers: admin,
        payload: { tag_ids: [id2] },
      });
      expect((replace.json().data as { items: Array<{ id: string }> }).items).toHaveLength(1);

      const mine = await app.inject({
        method: "GET",
        url: "/api/v1/admin/customers/cust_1/tags",
        headers: admin,
      });
      const tags = (mine.json().data as { items: Array<{ name: string }> }).items;
      expect(tags.map((t) => t.name)).toEqual(["待回购"]);

      // 客户列表带标签列
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/customers",
        headers: admin,
      });
      const items = (list.json().data as { items: Array<{ tags?: Array<{ name: string }> }> }).items;
      expect(items[0]!.tags?.map((t) => t.name)).toEqual(["待回购"]);
    });
  });

  it("按标签筛选客户：没带该标签的不返回", async () => {
    await withApp(async (app) => {
      const t1 = await app.inject({
        method: "POST",
        url: "/api/v1/admin/customer-tags",
        headers: admin,
        payload: { name: "高价值" },
      });
      const t2 = await app.inject({
        method: "POST",
        url: "/api/v1/admin/customer-tags",
        headers: admin,
        payload: { name: "待回购" },
      });
      const id1 = (t1.json().data as { id: string }).id;
      const id2 = (t2.json().data as { id: string }).id;

      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/customers/cust_1/tags",
        headers: admin,
        payload: { tag_ids: [id1] },
      });

      const hit = await app.inject({
        method: "GET",
        url: `/api/v1/admin/customers?tag_id=${id1}`,
        headers: admin,
      });
      expect((hit.json().data as { items: unknown[] }).items).toHaveLength(1);

      const miss = await app.inject({
        method: "GET",
        url: `/api/v1/admin/customers?tag_id=${id2}`,
        headers: admin,
      });
      expect((miss.json().data as { items: unknown[] }).items).toHaveLength(0);
    });
  });

  it("删标签：客户身上的关联一起清掉", async () => {
    await withApp(async (app) => {
      const t = await app.inject({
        method: "POST",
        url: "/api/v1/admin/customer-tags",
        headers: admin,
        payload: { name: "临时" },
      });
      const id = (t.json().data as { id: string }).id;
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/customers/cust_1/tags",
        headers: admin,
        payload: { tag_ids: [id] },
      });

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/customer-tags/${id}`,
        headers: admin,
      });
      expect(del.statusCode, del.body).toBe(200);

      const mine = await app.inject({
        method: "GET",
        url: "/api/v1/admin/customers/cust_1/tags",
        headers: admin,
      });
      expect((mine.json().data as { items: unknown[] }).items).toHaveLength(0);
    });
  });
});
