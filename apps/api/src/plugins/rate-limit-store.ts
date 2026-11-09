import type { Redis } from "ioredis";
import type { AppLogger } from "../types/logger.js";

export interface RateLimitStoreResult {
  current: number;
  ttl: number;
}

export type RateLimitStoreCallback = (err: Error | null, res?: RateLimitStoreResult) => void;

/** 与 @fastify/rate-limit 的 store 契约一致（incr / child）。 */
export interface RateLimitStore {
  incr(key: string, cb: RateLimitStoreCallback, timeWindow: number, max: number): void;
  child(routeOptions: unknown): RateLimitStore;
}

/** store 构造函数：@fastify/rate-limit 只传全局参数，业务配置由闭包捕获。 */
export type RateLimitStoreCtor = new (options: unknown) => RateLimitStore;

/**
 * 计数脚本：首次计数时设置过期时间，之后沿用原有 TTL（固定窗口）。
 * 返回 [当前计数, 剩余毫秒]，由调用方与 max 比较判断是否超限。
 */
const INCR_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

const COMMAND_NAME = "mallRateLimit";

/** 在 ioredis 客户端上注册计数脚本（重复调用安全）。 */
export function defineRateLimitCommand(redis: Redis): void {
  const existing = (redis as unknown as Record<string, unknown>)[COMMAND_NAME];
  if (typeof existing === "function") return;
  redis.defineCommand(COMMAND_NAME, { numberOfKeys: 1, lua: INCR_LUA });
}

/**
 * Redis 计数存储。
 * 键格式 `${prefix}${tier}:${ip}`：档位在键里，同档位的多个端点共用一个计数桶，
 * 不同档位互不干扰（登录的严格档不会消耗普通 API 的宽松档配额）。
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly options: { redis: Redis; prefix: string; logger?: AppLogger },
  ) {}

  incr(key: string, cb: RateLimitStoreCallback, timeWindow: number, _max: number): void {
    const redisKey = `${this.options.prefix}${key}`;
    const client = this.options.redis as Redis & {
      [COMMAND_NAME]: (...args: unknown[]) => void;
    };
    try {
      client[COMMAND_NAME](redisKey, timeWindow, (err: Error | null, result: unknown) => {
        if (err) {
          this.options.logger?.warn({ err, redisKey }, "限流计数失败，本次请求放行");
          cb(err);
          return;
        }
        const parsed = Array.isArray(result) ? result : [];
        cb(null, {
          current: Number(parsed[0] ?? 0),
          ttl: Number(parsed[1] ?? timeWindow),
        });
      });
    } catch (err) {
      cb(err as Error);
    }
  }

  child(): RateLimitStore {
    return new RedisRateLimitStore(this.options);
  }
}

/** 生成 store 构造函数（闭包捕获 Redis 客户端与键前缀）。 */
export function makeRedisStoreCtor(options: {
  redis: Redis;
  prefix: string;
  logger?: AppLogger;
}): RateLimitStoreCtor {
  return class RedisRateLimitStoreCtor extends RedisRateLimitStore {
    constructor() {
      super(options);
    }
  };
}
