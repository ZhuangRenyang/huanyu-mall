import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeClock, createFakeRateLimit, makeDeps } from "./helpers/fake-deps.js";

async function withApp(
  fn: (app: Awaited<ReturnType<typeof buildApp>>, deps: ReturnType<typeof makeDeps>) => Promise<void>,
  tweak?: (deps: ReturnType<typeof makeDeps>) => void,
): Promise<void> {
  const deps = makeDeps();
  tweak?.(deps);
  const fake = createFakeRateLimit(createFakeClock());
  const app = await buildApp(deps, { rateLimitStoreFactory: fake.factory });
  try {
    await fn(app, deps);
  } finally {
    await app.close();
  }
}

/** 造一个指定体积的 JSON 请求体（>1MB 且 <20MB）。 */
function bigJsonPayload(bytes: number): string {
  const filler = "x".repeat(bytes);
  return JSON.stringify({ filename: "a.png", content_type: "image/png", data_base64: filler });
}

describe("安全响应头与请求体限制（Phase 4）", () => {
  it("1. 响应带齐安全头", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(res.headers["x-xss-protection"]).toBe("1; mode=block");
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    });
  });

  it("2. HSTS 默认不下发（一期默认 HTTP），HTTPS_ENABLED=true 时才下发", async () => {
    await withApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
      expect(res.headers["strict-transport-security"]).toBeUndefined();
    });

    await withApp(
      async (app) => {
        const res = await app.inject({ method: "GET", url: "/api/v1/store/bootstrap" });
        expect(res.headers["strict-transport-security"]).toContain("max-age=31536000");
        expect(res.headers["strict-transport-security"]).toContain("includeSubDomains");
      },
      (deps) => {
        deps.config = {
          ...deps.config,
          security: { ...deps.config.security, httpsEnabled: true },
        };
      },
    );
  });

  it("3. 请求体超过全局 1MB 上限 → 413", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/settings/payment-providers/pp_wechat",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: bigJsonPayload(1_200_000),
      });
      expect(res.statusCode).toBe(413);
      const body = res.json();
      expect(body.code).toBe(20001);
      expect(body.message).toBe("请求体超出允许的大小限制");
      expect(typeof body.requestId).toBe("string");
    });
  });

  it("4. 图片上传端点放宽到 20MB：1MB 以上仍可上传", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/files",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: bigJsonPayload(1_200_000),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.id).toBe("file_1");
    });
  });

  it("5. 图片上传端点超过 20MB 仍被拒（与 nginx client_max_body_size 20m 对齐）", async () => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/files",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        payload: bigJsonPayload(21_000_000),
      });
      expect(res.statusCode).toBe(413);
    });
  });
});
