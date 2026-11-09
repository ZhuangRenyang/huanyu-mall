import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadMigrationsFromDir, MigrationRunner } from "../src/db/migrate.js";
import type { MigrationFile } from "../src/db/migrate.js";

/** 模拟 pg.Pool：验证迁移执行器的幂等（schema_migrations 跟踪，第二遍跳过）。 */
class FakePool {
  readonly applied = new Set<string>();

  async connect() {
    return {
      query: (sql: string, params?: unknown[]) => this.query(sql, params),
      release: () => {},
    };
  }

  async query(sql: string, params?: unknown[]) {
    if (sql.includes("SELECT 1 FROM schema_migrations WHERE name")) {
      const name = params?.[0] as string;
      return { rowCount: this.applied.has(name) ? 1 : 0, rows: [] };
    }
    if (sql.includes("INSERT INTO schema_migrations")) {
      this.applied.add(params?.[0] as string);
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  }
}

describe("MigrationRunner 迁移可重放", () => {
  it("对空库跑两遍：第一遍应用、第二遍跳过，无错", async () => {
    const pool = new FakePool();
    const runner = new MigrationRunner(pool as never);
    const migrations: MigrationFile[] = [
      { name: "0001_init.sql", sql: "CREATE TABLE region (id text PRIMARY KEY);" },
    ];

    const first = await runner.run(migrations);
    expect(first).toEqual([{ name: "0001_init.sql", applied: true }]);
    expect(pool.applied.has("0001_init.sql")).toBe(true);

    const second = await runner.run(migrations);
    expect(second).toEqual([{ name: "0001_init.sql", applied: false }]);
  });

  it("真实迁移文件（core + modules + links）跑两遍均可重放", async () => {
    const specs = [
      { dir: "migrations", ns: "core" },
      { dir: "../modules/region-channel/migrations", ns: "region-channel" },
      { dir: "../modules/product/migrations", ns: "product" },
      { dir: "../modules/pricing/migrations", ns: "pricing" },
      { dir: "../modules/file/migrations", ns: "file" },
      { dir: "../modules/inventory/migrations", ns: "inventory" },
      { dir: "../modules/cart/migrations", ns: "cart" },
      { dir: "../modules/order/migrations", ns: "order" },
      { dir: "../modules/auth/migrations", ns: "auth" },
      { dir: "../modules/customer/migrations", ns: "customer" },
      { dir: "../modules/tax/migrations", ns: "tax" },
      { dir: "../modules/payment/migrations", ns: "payment" },
      { dir: "../modules/fulfillment/migrations", ns: "fulfillment" },
      { dir: "../modules/theme/migrations", ns: "theme" },
      { dir: "../links/migrations", ns: "links" },
    ].filter((s) => existsSync(s.dir));

    const files = (
      await Promise.all(specs.map((s) => loadMigrationsFromDir(s.dir, s.ns)))
    ).flat();
    expect(files.length).toBeGreaterThanOrEqual(6);

    const pool = new FakePool();
    const runner = new MigrationRunner(pool as never);

    const first = await runner.run(files);
    expect(first.every((r) => r.applied)).toBe(true);
    expect(pool.applied.size).toBe(files.length);

    const second = await runner.run(files);
    expect(second.every((r) => !r.applied)).toBe(true);
  });
});
