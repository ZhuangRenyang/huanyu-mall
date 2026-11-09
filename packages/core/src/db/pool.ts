import { Client, Pool } from "pg";

export interface DbPoolOptions {
  connectionString: string;
  max?: number;
  statementTimeoutMs?: number;
  onError?: (err: Error) => void;
}

/**
 * 连接池统一入口（架构 §10.1）：禁业务自建 pg.Pool，一律走 core/db。
 * PgBouncer transaction 模式下禁命名 prepared statement：node-postgres 默认走匿名参数
 * （$1），不触发命名 prepare，理论兼容；statement_timeout 兜底。
 */
export function createPool(opts: DbPoolOptions): Pool {
  const pool = new Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
  });
  const timeout = opts.statementTimeoutMs ?? 5000;
  pool.on("connect", (client) => {
    client.query(`SET statement_timeout = ${timeout}`).catch(() => {});
  });
  pool.on("error", (err) => {
    const onError = opts.onError ?? ((e: Error) => console.error("[db] pool error:", e.message));
    onError(err);
  });
  return pool;
}

/** 一次性探活：SELECT 1（短超时，服务未连返回 false 而不抛）。 */
export async function pingDatabase(connectionString: string, timeoutMs = 1000): Promise<boolean> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
