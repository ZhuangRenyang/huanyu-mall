import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";
import type { ApiConfig } from "../src/config.js";

interface Harness {
  app: Awaited<ReturnType<typeof buildApp>>;
  clock: ReturnType<typeof createFakeClock>;
  counters: Map<string, { current: number; expiresAt: number }>;
}

/** 起一个带假限流存储的 app：阈值可配，时钟可控，不依赖真 Redis。 */
async function withLimitedApp(
  rateLimit: Partial<ApiConfig["rateLimit"]>,
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  const deps = makeDeps();
  const clock = createFakeClock();
  const fake = createFakeRateLimit(clock);
  deps.config = {
    ...deps.config,
    rateLimit: { ...deps.config.rateLimit, ...rateLimit },
  };
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn({ app, clock, counters: fake.counters });
  } finally {
    await app.close();
  }
}

const loginPayload = { email: "admin@x.com", password: "pw123456" };

describe("限流防刷（Phase 4）", () => {
  it("1. 登录端点超过阈值后第 N+1 次被拒：429 + 统一信封 + 中文提示", async () => {
    await withLimitedApp({ authMax: 3 }, async ({ app }) => {
      for (let i = 0; i < 3; i++) {
        const ok = await app.inject({
          method: "POST",
          url: "/api/v1/admin/auth/login",
          headers: { "content-type": "application/json" },
          payload: loginPayload,
          remoteAddress: "203.0.113.10",
        });
        expect(ok.statusCode).toBe(200);
      }

      const blocked = await app.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        headers: { "content-type": "application/json" },
        payload: loginPayload,
        remoteAddress: "203.0.113.10",
      });
      expect(blocked.statusCode).toBe(429);
      const body = blocked.json();
      // 项目统一响应信封：{code,data,message,requestId}
      expect(body.code).toBe(60001);
      expect(body.data).toBeNull();
      expect(typeof body.message).toBe("string");
      expect(body.message).toBe("管理员登录尝试过于频繁，请 1 分钟后再试");
      expect(typeof body.requestId).toBe("string");
      expect(body.requestId.length).toBeGreaterThan(0);
    });
  });

  it("2. 不同 IP 互不影响：另一 IP 仍可正常登录", async () => {
    await withLimitedApp({ authMax: 2 }, async ({ app }) => {
      for (let i = 0; i < 2; i++) {
        const ok = await app.inject({
          method: "POST",
          url: "/api/v1/store/auth/login",
          headers: { "content-type": "application/json" },
          payload: { email: "a@b.com", password: "pw" },
          remoteAddress: "203.0.113.20",
        });
        expect(ok.statusCode).toBe(200);
      }
      const blocked = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "a@b.com", password: "pw" },
        remoteAddress: "203.0.113.20",
      });
      expect(blocked.statusCode).toBe(429);

      const otherIp = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "a@b.com", password: "pw" },
        remoteAddress: "198.51.100.7",
      });
      expect(otherIp.statusCode).toBe(200);
    });
  });

  it("3. 窗口过期后自动恢复（假时钟推进，不真等）", async () => {
    await withLimitedApp({ authMax: 1, authWindowMs: 60_000 }, async ({ app, clock }) => {
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/register",
        headers: { "content-type": "application/json" },
        payload: { email: "a@b.com", password: "password123" },
        remoteAddress: "203.0.113.30",
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/register",
        headers: { "content-type": "application/json" },
        payload: { email: "a@b.com", password: "password123" },
        remoteAddress: "203.0.113.30",
      });
      expect(second.statusCode).toBe(429);

      clock.advance(60_001);
      const third = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/register",
        headers: { "content-type": "application/json" },
        payload: { email: "a@b.com", password: "password123" },
        remoteAddress: "203.0.113.30",
      });
      expect(third.statusCode).toBe(201);
    });
  });

  it("4. 登录/注册/管理员登录共用同一个严格档计数桶（不能靠换端点放大尝试次数）", async () => {
    await withLimitedApp({ authMax: 3 }, async ({ app, counters }) => {
      const send = (url: string, payload: unknown) =>
        app.inject({
          method: "POST",
          url,
          headers: { "content-type": "application/json" },
          payload: payload as object,
          remoteAddress: "203.0.113.40",
        });

      expect((await send("/api/v1/store/auth/login", { email: "a@b.com", password: "pw" })).statusCode).toBe(200);
      expect((await send("/api/v1/admin/auth/login", loginPayload)).statusCode).toBe(200);
      expect((await send("/api/v1/store/auth/register", { email: "a@b.com", password: "password123" })).statusCode).toBe(201);

      // 三个端点共用 auth 桶 → 计数应为 3，且第 4 次（任意端点）被拒
      const authKeys = [...counters.keys()].filter((k) => k.startsWith("auth:"));
      expect(authKeys).toHaveLength(1);
      expect(counters.get(authKeys[0]!)?.current).toBe(3);

      const blocked = await send("/api/v1/store/auth/login", { email: "a@b.com", password: "pw" });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().message).toBe("登录尝试过于频繁，请 1 分钟后再试");
    });
  });

  it("5. 下单端点走中等档，其余 API 走宽松档（分档独立计数）", async () => {
    await withLimitedApp({ authMax: 2, checkoutMax: 2, max: 50 }, async ({ app, counters }) => {
      const complete = () =>
        app.inject({
          method: "POST",
          url: "/api/v1/store/carts/cart_1/complete",
          headers: { "idempotency-key": "idem-rl-1" },
          remoteAddress: "203.0.113.50",
        });

      expect((await complete()).statusCode).toBe(201);
      expect((await complete()).statusCode).toBe(201);
      const blocked = await complete();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().message).toBe("下单请求过于频繁，请 1 分钟后再试");

      // 普通读接口不受下单档影响（独立计数桶）
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/store/products?limit=20&offset=0",
        remoteAddress: "203.0.113.50",
      });
      expect(list.statusCode).toBe(200);

      const bucketKeys = [...counters.keys()].sort();
      expect(bucketKeys.some((k) => k.startsWith("checkout:"))).toBe(true);
      expect(bucketKeys.some((k) => k.startsWith("default:"))).toBe(true);
    });
  });

  it("6. 健康检查不参与限流（容器探活不占业务配额）", async () => {
    await withLimitedApp({ max: 1 }, async ({ app }) => {
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({ method: "GET", url: "/api/v1/health" });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  it("7. 超限响应带限流头，便于客户端退避", async () => {
    await withLimitedApp({ authMax: 1 }, async ({ app }) => {
      await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "a@b.com", password: "pw" },
        remoteAddress: "203.0.113.60",
      });
      const blocked = await app.inject({
        method: "POST",
        url: "/api/v1/store/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "a@b.com", password: "pw" },
        remoteAddress: "203.0.113.60",
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers["x-ratelimit-limit"]).toBe("1");
      expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");
      expect(blocked.headers["retry-after"]).toBeDefined();
    });
  });
});
