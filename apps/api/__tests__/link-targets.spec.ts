import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/** 链接选择器（ADR-081）：返回的路径必须带 locale/channel 前缀，否则店面 404。 */
async function withApp(fn: (app: Awaited<ReturnType<typeof buildApp>>) => Promise<void>) {
  const deps = makeDeps();
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

describe("链接选择器（ADR-081）", () => {
  it("搜商品返回带前缀的路径", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/link-targets?type=product",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{ label: string; href: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.href).toContain("/products/tee");
      expect(items[0]?.href.startsWith("/")).toBe(true);
    });
  });

  it("分类类型返回分类路径（带 category 参数）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/link-targets?type=category",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{ href: string }>;
      for (const item of items) expect(item.href).toContain("/products?category=");
    });
  });
});
