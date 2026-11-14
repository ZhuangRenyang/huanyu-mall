import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/** 微页面（ADR-082）：slug 有格式门槛；店面只给已发布。 */
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

const adminJson = { authorization: "Bearer admin", "content-type": "application/json" };

describe("微页面（ADR-082）", () => {
  it("非法 slug → 400（大写/下划线/中文都不行）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/settings/pages",
        headers: adminJson,
        payload: { slug: "About_Us", title: "关于" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("店面只给已发布：草稿 404", async () => {
    await withApp(async (app) => {
      const ok = await app.inject({ method: "GET", url: "/api/v1/store/pages/about" });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().data.title).toBe("关于我们");
      const draft = await app.inject({ method: "GET", url: "/api/v1/store/pages/draft" });
      expect(draft.statusCode).toBe(404);
    });
  });
});
