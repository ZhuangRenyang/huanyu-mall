import type { ApiConfig } from "../config.js";
import { probeDb, probeMigrations, probeQueue, probeRedis, type ProbeStatus } from "../infra/probes.js";

export interface HealthData {
  status: "ok" | "degraded";
  db: ProbeStatus;
  redis: ProbeStatus;
  queue: ProbeStatus;
  migrations: string;
  uptime: number;
}

export async function checkHealth(config: ApiConfig): Promise<HealthData> {
  const [db, redis, queue] = await Promise.all([
    probeDb(config.databaseUrl),
    probeRedis(config.redisUrl),
    probeQueue(config.redisUrl),
  ]);
  const migrations = db === "ok" ? await probeMigrations(config.databaseUrl) : "degraded";
  const status = db === "ok" && redis === "ok" && queue === "ok" ? "ok" : "degraded";
  return { status, db, redis, queue, migrations, uptime: Math.round(process.uptime()) };
}
