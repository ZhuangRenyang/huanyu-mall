import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

/**
 * 通道列表（ADR-083）。
 *
 * 后台支付页原来调 `GET /settings/payment-providers`，但接口不存在 ——
 * live 下请求 404、前端 catch 后静默退回默认四家，商家看到的「已启用」是假的。
 */
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

describe("支付通道列表（ADR-083）", () => {
  it("返回全部通道：禁用过的也要在（否则商家以为只剩一家）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings/payment-providers",
        headers: { authorization: "Bearer admin" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().data.items as Array<{
        identifier: string;
        is_enabled: boolean;
        options_masked: Record<string, string>;
      }>;
      expect(items.map((i) => i.identifier)).toEqual(["alipay", "wechat"]);
      expect(items[1]?.is_enabled).toBe(false);
      // 只回掩码，绝不回明文
      expect(Object.values(items[0]?.options_masked ?? {}).every((v) => v.startsWith("****"))).toBe(true);
    });
  });
});
