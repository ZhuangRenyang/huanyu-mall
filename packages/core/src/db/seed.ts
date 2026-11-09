import type { Pool } from "pg";

/**
 * 数据种子执行器（架构 §9.3 步骤 8）：靠 seed_versions 表幂等，只跑一次。
 * 与迁移分离：迁移是 schema，种子是初始数据。
 */
export class SeedRunner {
  constructor(private readonly pool: Pool) {}

  async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS seed_versions (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async hasRun(name: string): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM seed_versions WHERE name = $1`, [name]);
    return (res.rowCount ?? 0) > 0;
  }

  async run(name: string, fn: () => Promise<void>): Promise<{ name: string; applied: boolean }> {
    await this.ensureTable();
    if (await this.hasRun(name)) return { name, applied: false };
    await fn();
    await this.pool.query(`INSERT INTO seed_versions (name) VALUES ($1)`, [name]);
    return { name, applied: true };
  }
}
