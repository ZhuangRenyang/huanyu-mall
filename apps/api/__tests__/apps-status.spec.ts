import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

describe("应用接入状态（ADR-084）", () => {
  it("返回支付/邮件/渠道三项真实状态", async () => {
    const deps = makeDeps();
    const fake = createFakeRateLimit(createFakeClock());
    const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/apps/status",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const d = res.json().data as any;
      expect(d.payments).toMatchObject({ total: expect.any(Number), enabled: expect.any(Number) });
      expect(typeof d.mail.enabled).toBe("boolean");
      expect(d.channels.active).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
