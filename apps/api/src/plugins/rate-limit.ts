import rateLimit from "@fastify/rate-limit";
import type { FastifyRateLimitStoreCtor } from "@fastify/rate-limit";
import { Redis } from "ioredis";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "@mall/core";
import type { RateLimitConfig } from "../config.js";
import type { AppLogger } from "../types/logger.js";
import { normalizeClientIp } from "../utils/ip.js";
import {
  isExemptPath,
  policyForTier,
  rateLimitMessage,
  requestPath,
  resolveTier,
} from "./rate-limit-tiers.js";
import {
  defineRateLimitCommand,
  makeRedisStoreCtor,
  type RateLimitStoreCtor,
} from "./rate-limit-store.js";

export interface RateLimitPluginDeps {
  config: RateLimitConfig;
  logger: AppLogger;
  redisUrl: string;
  /** 存储工厂注入点：测试用假 store（可控时钟），生产走 Redis。 */
  storeFactory?: (config: RateLimitConfig, logger: AppLogger) => RateLimitStoreCtor;
}

/**
 * 限流插件（Phase 4 加固）。
 *
 * 分档：登录/注册严格档 → 下单中等档 → 其余 API 宽松档，按客户端 IP 计数。
 * 超限抛 DomainError(60001)，由统一错误处理映射为 HTTP 429 + 项目统一响应信封。
 */
export async function registerRateLimit(
  app: FastifyInstance,
  deps: RateLimitPluginDeps,
): Promise<void> {
  const { config, logger } = deps;
  if (!config.enabled) {
    logger.warn("限流未启用（RATE_LIMIT_ENABLED=false），当前所有端点不限流");
    return;
  }

  let redis: Redis | null = null;
  let storeCtor: RateLimitStoreCtor;
  if (deps.storeFactory) {
    storeCtor = deps.storeFactory(config, logger);
  } else {
    redis = new Redis(deps.redisUrl, {
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      // 断开时不排队等待：计数失败即放行（skipOnError），避免 Redis 抖动拖垮接口。
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    redis.on("error", (err: Error) => {
      logger.error({ err }, "限流 Redis 连接异常");
    });
    defineRateLimitCommand(redis);
    storeCtor = makeRedisStoreCtor({ redis, prefix: config.redisPrefix, logger });
  }

  app.addHook("onClose", async () => {
    redis?.disconnect();
  });

  // 必须 await：@fastify/rate-limit 靠 onRoute 钩子把限流处理器挂到每条路由上，
  // 钩子只有在插件加载完成后才存在。不 await 会导致所有路由都不限流（静默失效）。
  await app.register(rateLimit, {
    global: true,
    store: storeCtor as unknown as FastifyRateLimitStoreCtor,
    max: (req: FastifyRequest) => policyForTier(resolveTier(requestPath(req)), config).max,
    timeWindow: (req: FastifyRequest) =>
      policyForTier(resolveTier(requestPath(req)), config).windowMs,
    keyGenerator: (req: FastifyRequest) =>
      `${resolveTier(requestPath(req))}:${clientIp(req)}`,
    allowList: (req: FastifyRequest) => isExemptPath(requestPath(req)),
    // 计数存储故障时放行：可用性优先于防刷（防刷是加固项，不能拖垮主链路）。
    skipOnError: true,
    errorResponseBuilder: (req: FastifyRequest) => {
      const path = requestPath(req);
      const tier = resolveTier(path);
      const policy = policyForTier(tier, config);
      return errors.rateLimited(rateLimitMessage(path, tier, policy.windowMs));
    },
  });
}

/** 客户端 IP：依赖 trustProxy 配置才能拿到 nginx 之后的真实客户端 IP。 */
function clientIp(req: FastifyRequest): string {
  const ip = req.ip;
  return normalizeClientIp(typeof ip === "string" ? ip : "unknown");
}
