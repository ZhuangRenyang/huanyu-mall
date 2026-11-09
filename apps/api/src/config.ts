/** 限流分档配置（Phase 4 加固）。所有阈值均可经环境变量覆盖，默认值面向单商户跨境商城。 */
export interface RateLimitConfig {
  /** 限流总开关；关闭后所有端点不限流（仅本地调试用）。 */
  enabled: boolean;
  /** 宽松档：其余 API 每 IP 每窗口请求数。 */
  max: number;
  windowMs: number;
  /** 严格档：登录/注册端点，挡凭据猜测与账号批量注册。 */
  authMax: number;
  authWindowMs: number;
  /** 中等档：下单端点，挡刷单与重复扣款。 */
  checkoutMax: number;
  checkoutWindowMs: number;
  /** Redis 键前缀（多环境共用 Redis 时按环境隔离）。 */
  redisPrefix: string;
}

/** 安全加固配置（Phase 4）：响应头 + 请求体上限 + 反向代理信任范围。 */
export interface SecurityConfig {
  /** 是否以 HTTPS 对外提供服务；Strict-Transport-Security 仅在该开关为 true 时下发。 */
  httpsEnabled: boolean;
  /** HSTS max-age（秒）。 */
  hstsMaxAge: number;
  /** 全局请求体上限（字节），默认 1MB。 */
  bodyLimitBytes: number;
  /** 图片上传端点请求体上限（字节），默认 20MB，与 nginx client_max_body_size 20m 对齐。 */
  uploadBodyLimitBytes: number;
  /**
   * 受信任的反向代理网段（nginx 所在网段）。
   * 限流按客户端 IP 计数，必须信任 nginx 才能取到真实客户端 IP；
   * 不可设为 "true"（全信任会让客户端伪造 X-Forwarded-For 绕过限流）。
   */
  trustProxy: string[];
}

export interface ApiConfig {
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  logLevel: string;
  corsOrigins: string[];
  rateLimit: RateLimitConfig;
  security: SecurityConfig;
}

/** 默认信任的私网网段：docker bridge / k8s pod 网段（nginx 与 API 同网）。 */
const DEFAULT_TRUST_PROXY = ["172.16.0.0/12", "10.0.0.0/8", "192.168.0.0/16"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL ?? "postgresql://mall:mall@localhost:5432/mall",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    logLevel: env.LOG_LEVEL ?? "info",
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5173")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    rateLimit: loadRateLimitConfig(env),
    security: loadSecurityConfig(env),
  };
}

export function loadRateLimitConfig(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    enabled: readBool(env, "RATE_LIMIT_ENABLED", true),
    max: readInt(env, "RATE_LIMIT_MAX", 300, 1),
    windowMs: readInt(env, "RATE_LIMIT_WINDOW_MS", 60_000, 1_000),
    authMax: readInt(env, "RATE_LIMIT_AUTH_MAX", 5, 1),
    authWindowMs: readInt(env, "RATE_LIMIT_AUTH_WINDOW_MS", 60_000, 1_000),
    checkoutMax: readInt(env, "RATE_LIMIT_CHECKOUT_MAX", 10, 1),
    checkoutWindowMs: readInt(env, "RATE_LIMIT_CHECKOUT_WINDOW_MS", 60_000, 1_000),
    redisPrefix: env.RATE_LIMIT_REDIS_PREFIX ?? "mall:rl:",
  };
}

export function loadSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  return {
    httpsEnabled: readBool(env, "HTTPS_ENABLED", false),
    hstsMaxAge: readInt(env, "HSTS_MAX_AGE", 31_536_000, 0),
    bodyLimitBytes: readInt(env, "BODY_LIMIT_BYTES", 1_048_576, 1_024),
    uploadBodyLimitBytes: readInt(env, "UPLOAD_BODY_LIMIT_BYTES", 20_971_520, 1_024),
    trustProxy: readList(env, "TRUST_PROXY", DEFAULT_TRUST_PROXY),
  };
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function readList(env: NodeJS.ProcessEnv, key: string, fallback: string[]): string[] {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}
