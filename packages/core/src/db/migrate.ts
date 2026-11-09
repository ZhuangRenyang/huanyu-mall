import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { createPool } from "./pool.js";

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface MigrationResult {
  name: string;
  applied: boolean;
}

const MIGRATIONS_TABLE = "schema_migrations";
const ADVISORY_LOCK_KEY = 20261108;

/** 迁移执行器：直连 PG（非 PgBouncer），advisory lock 串行 + 每文件一个事务。 */
export class MigrationRunner {
  constructor(private readonly pool: Pool) {}

  async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async listApplied(): Promise<{ name: string; appliedAt: string }[]> {
    await this.ensureTable();
    const res = await this.pool.query(
      `SELECT name, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY name ASC`,
    );
    return res.rows.map((r) => ({ name: r.name as string, appliedAt: (r.applied_at as Date).toISOString() }));
  }

  async latestApplied(): Promise<string | null> {
    await this.ensureTable();
    const res = await this.pool.query(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name DESC LIMIT 1`,
    );
    return (res.rows[0]?.name as string | undefined) ?? null;
  }

  async run(migrations: MigrationFile[]): Promise<MigrationResult[]> {
    await this.ensureTable();
    const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
    const client = await this.pool.connect();
    const results: MigrationResult[] = [];
    try {
      await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
      for (const m of sorted) {
        const existing = await client.query(
          `SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE name = $1`,
          [m.name],
        );
        if ((existing.rowCount ?? 0) > 0) {
          results.push({ name: m.name, applied: false });
          continue;
        }
        const checksum = sha256(m.sql);
        await client.query("BEGIN");
        try {
          await client.query(m.sql);
          await client.query(
            `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES ($1, $2)`,
            [m.name, checksum],
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
        results.push({ name: m.name, applied: true });
      }
      return results;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
      client.release();
    }
  }
}

/**
 * 从目录加载 .sql 迁移。多个模块的迁移文件可能同名（如 0001_init.sql），
 * 必须用 namespace（模块名）前缀保证 schema_migrations 全局唯一，否则第二遍会被误判为已应用。
 */
export async function loadMigrationsFromDir(dir: string, namespace?: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (file) => ({
      name: namespace ? `${namespace}/${file}` : file,
      sql: await readFile(join(dir, file), "utf8"),
    })),
  );
}

/** 一次性查询最新已应用迁移名（不建表，不返回则 null）。供健康检查探活用。 */
export async function latestAppliedMigration(connectionString: string): Promise<string | null> {
  const pool = createPool({ connectionString, max: 1 });
  try {
    const res = await pool.query(
      "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1",
    );
    return (res.rows[0]?.name as string | undefined) ?? null;
  } catch {
    return null;
  } finally {
    await pool.end().catch(() => {});
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
