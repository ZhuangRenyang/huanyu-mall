import type { FastifyRequest } from "fastify";
import type { RateLimitConfig } from "../config.js";

/** 限流档位：严格（登录注册）/ 中等（下单）/ 宽松（其余 API）。 */
export type RateLimitTier = "auth" | "checkout" | "default";

export interface RateLimitPolicy {
  tier: RateLimitTier;
  max: number;
  windowMs: number;
}

/**
 * 严格档端点：凭据猜测（登录）、账号批量注册、管理员改密共用同一个计数桶。
 * 共用而非分开计数，是为了让攻击者无法通过在多个端点之间轮换来放大尝试次数。
 * 改密同档的原因：它同样要校验「当前口令」，是可被用来试口令的入口。
 */
const AUTH_PATHS = new Set([
  "/api/v1/store/auth/login",
  "/api/v1/store/auth/login/phone",
  "/api/v1/store/auth/register",
  // 发码也要限：邮件通道上线后，不设限就等于把店铺变成「给任意邮箱发信」的跳板
  "/api/v1/store/auth/codes",
  "/api/v1/admin/auth/login",
  "/api/v1/admin/auth/change-password",
]);

/** 中等档端点：购物车结账完成（下单）。 */
const CHECKOUT_PATTERN = /^\/api\/v1\/store\/carts\/[^/]+\/complete$/;

/** 不参与限流的端点：容器健康检查每 10s 一次，不应占用业务配额。 */
const EXEMPT_PATHS = new Set(["/api/v1/health"]);

/** 取请求路径：优先用路由模板（/api/v1/store/carts/:id/complete），回落原始 URL。 */
export function requestPath(req: FastifyRequest): string {
  const routeUrl = req.routeOptions?.url;
  const raw = typeof routeUrl === "string" && routeUrl.length > 0 ? routeUrl : req.url;
  const queryIndex = raw.indexOf("?");
  return queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
}

export function resolveTier(path: string): RateLimitTier {
  if (AUTH_PATHS.has(path)) return "auth";
  if (CHECKOUT_PATTERN.test(path)) return "checkout";
  return "default";
}

export function isExemptPath(path: string): boolean {
  return EXEMPT_PATHS.has(path);
}

export function policyForTier(tier: RateLimitTier, config: RateLimitConfig): RateLimitPolicy {
  switch (tier) {
    case "auth":
      return { tier, max: config.authMax, windowMs: config.authWindowMs };
    case "checkout":
      return { tier, max: config.checkoutMax, windowMs: config.checkoutWindowMs };
    default:
      return { tier: "default", max: config.max, windowMs: config.windowMs };
  }
}

/** 等待时长文案按真实窗口换算：窗口改成 30 秒时提示也跟着变，不写死「1 分钟」。 */
export function formatWait(windowMs: number): string {
  const seconds = Math.ceil(windowMs / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}

/** 超限提示：具体中文业务语义，不用空洞模板文案。 */
export function rateLimitMessage(path: string, tier: RateLimitTier, windowMs: number): string {
  const wait = formatWait(windowMs);
  if (path === "/api/v1/store/auth/login") return `登录尝试过于频繁，请 ${wait}后再试`;
  if (path === "/api/v1/store/auth/login/phone") return `验证码登录尝试过于频繁，请 ${wait}后再试`;
  if (path === "/api/v1/admin/auth/login") return `管理员登录尝试过于频繁，请 ${wait}后再试`;
  if (path === "/api/v1/admin/auth/change-password") return `密码修改尝试过于频繁，请 ${wait}后再试`;
  if (path === "/api/v1/store/auth/register") return `账号注册请求过于频繁，请 ${wait}后再试`;
  if (path === "/api/v1/store/auth/codes") return `验证码请求过于频繁，请 ${wait}后再试`;
  if (tier === "checkout") return `下单请求过于频繁，请 ${wait}后再试`;
  return `接口请求过于频繁，请 ${wait}后再试`;
}
