import type { FastifyInstance } from "fastify";
import type { SecurityConfig } from "../config.js";

/**
 * 安全响应头（Phase 4 加固）。
 * HSTS 只在 HTTPS_ENABLED=true 时下发：一期默认 HTTP 直连，误发 HSTS 会让浏览器
 * 强制 HTTPS 访问一个仍是 HTTP 的站点，导致整站不可用。
 */
export function securityHeadersPlugin(app: FastifyInstance, config: SecurityConfig): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-XSS-Protection", "1; mode=block");
    reply.header("X-Permitted-Cross-Domain-Policies", "none");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (config.httpsEnabled) {
      reply.header("Strict-Transport-Security", `max-age=${config.hstsMaxAge}; includeSubDomains`);
    }
    return payload;
  });
}
