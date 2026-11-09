import type { FastifyInstance } from "fastify";
import type { SecurityConfig } from "../config.js";

/**
 * 安全响应头（Phase 4 加固）。
 * HSTS 只在 HTTPS_ENABLED=true 时下发：一期默认 HTTP 直连，误发 HSTS 会让浏览器
 * 强制 HTTPS 访问一个仍是 HTTP 的站点，导致整站不可用。
 *
 * 用 `onRequest` 而不是 `onSend`：Fastify 5.12.8 下多个 onSend 钩子同时设响应头会
 * 二次 writeHead（`ERR_HTTP_HEADERS_SENT`，每个请求刷一条错误日志、偶发把 200 变 500）。
 * 实测对照见 `request-id.ts` 注释。放在 onRequest 的额外好处：错误响应（4xx/5xx）
 * 也会带上这些头，而 onSend 在异常路径上不一定执行。
 */
export function securityHeadersPlugin(app: FastifyInstance, config: SecurityConfig): void {
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-XSS-Protection", "1; mode=block");
    reply.header("X-Permitted-Cross-Domain-Policies", "none");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (config.httpsEnabled) {
      reply.header("Strict-Transport-Security", `max-age=${config.hstsMaxAge}; includeSubDomains`);
    }
  });
}
