import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { latestAppliedMigration, pingDatabase } from "@mall/core";

export type ProbeStatus = "ok" | "degraded";

export async function probeDb(databaseUrl: string): Promise<ProbeStatus> {
  return (await pingDatabase(databaseUrl, 1000)) ? "ok" : "degraded";
}

export async function probeRedis(redisUrl: string): Promise<ProbeStatus> {
  const redis = new Redis(redisUrl, {
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  redis.on("error", () => {});
  try {
    await withTimeout(redis.connect(), 1200);
    const pong = await withTimeout(redis.ping(), 800);
    return pong === "PONG" ? "ok" : "degraded";
  } catch {
    return "degraded";
  } finally {
    redis.disconnect();
  }
}

export async function probeQueue(redisUrl: string): Promise<ProbeStatus> {
  let queue: Queue | undefined;
  try {
    queue = new Queue("health-probe", { connection: parseRedisUrl(redisUrl) });
    const counts = await withTimeout(queue.getJobCounts(), 1500);
    return counts ? "ok" : "degraded";
  } catch {
    return "degraded";
  } finally {
    if (queue) await queue.close().catch(() => {});
  }
}

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "localhost",
    port: Number(parsed.port || 6379),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
  };
}

/** 最新已应用迁移名；DB 已探活成功时才调用。无迁移返回 "none"。 */
export async function probeMigrations(databaseUrl: string): Promise<string> {
  const latest = await latestAppliedMigration(databaseUrl);
  return latest ?? "none";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
