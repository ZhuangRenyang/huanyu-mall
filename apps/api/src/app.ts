import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { newRequestId } from "@mall/core";
import type { AppDeps } from "./deps.js";
import { setupRequestId } from "./plugins/request-id.js";
import { setupResponse } from "./plugins/response.js";
import { zodValidatorPlugin } from "./plugins/validator.js";
import { corsPlugin } from "./plugins/cors.js";
import { securityHeadersPlugin } from "./plugins/security-headers.js";
import { registerRateLimit, type RateLimitPluginDeps } from "./plugins/rate-limit.js";
import { registerRoutes } from "./routes/index.js";

export interface BuildAppOptions {
  /** 限流存储工厂注入点（测试注入假 store，生产走 Redis）。 */
  rateLimitStoreFactory?: RateLimitPluginDeps["storeFactory"];
}

/** 入口：只装配（校验器 + 错误映射 + CORS + 安全头 + 限流 + 路由 + 启动），零业务逻辑。 */
export async function buildApp(
  deps: AppDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.logLevel },
    genReqId: () => newRequestId(),
    requestIdHeader: "x-request-id",
    // 全局请求体上限 1MB；图片上传端点单独放宽（见 routes/admin/files.ts）。
    bodyLimit: deps.config.security.bodyLimitBytes,
    // 信任 nginx 网段：限流要取 nginx 之后的真实客户端 IP，不能设为全信任。
    trustProxy: deps.config.security.trustProxy,
  });

  // 保留原始 body 供 webhook 验签（JSON 解析会丢原始字节）
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req: FastifyRequest & { rawBody?: string }, body: string, done: (err: Error | null, parsed?: unknown) => void) => {
      req.rawBody = body;
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  /*
   * 支付回调不只 JSON：支付宝（电脑/手机网站支付）用 application/x-www-form-urlencoded，
   * 微信 V3 与 PayPal 才是 JSON。
   *
   * Fastify 默认**没有** form-encoded 解析器，不注册这一条的话支付宝回调会被直接 415 拒掉；
   * 即使注册，若不在这里存 rawBody，验签时只能拿 `JSON.stringify(req.body)` 去还原，
   * 而支付宝要求对「URL 解码后的原始 form 参数」签名 —— 两者不可能一致，验签必然失败。
   *
   * 自己写这 10 行而不是引 @fastify/formbody：项目对依赖有节制（铁律 11），
   * 而这里需要的只是「存原文 + 转成对象」两件事。
   */
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (req: FastifyRequest & { rawBody?: string }, body: string, done: (err: Error | null, parsed?: unknown) => void) => {
      req.rawBody = body;
      try {
        done(null, Object.fromEntries(new URLSearchParams(body)));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  zodValidatorPlugin(app);
  corsPlugin(app, deps.config.corsOrigins);
  setupRequestId(app);
  setupResponse(app);
  securityHeadersPlugin(app, deps.config.security);
  // 限流必须先于路由注册：插件靠 onRoute 钩子逐条挂载限流处理器。
  await registerRateLimit(app, {
    config: deps.config.rateLimit,
    logger: app.log,
    redisUrl: deps.config.redisUrl,
    storeFactory: options.rateLimitStoreFactory,
  });
  registerRoutes(app, deps);

  return app;
}

export function getRawBody(req: FastifyRequest): string {
  return (req as FastifyRequest & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
}
