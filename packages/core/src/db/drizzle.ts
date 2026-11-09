import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

/** 为业务模块创建独立 schema 的 drizzle 实例（模块用自己的 models，避免内核 schema 污染）。 */
export function createDbFor<TSchema extends Record<string, unknown>>(
  pool: Pool,
  schema: TSchema,
): NodePgDatabase<TSchema> {
  return drizzle(pool, { schema });
}

export type { NodePgDatabase };
