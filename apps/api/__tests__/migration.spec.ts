import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMigrationsFromDir } from "@mall/core";
import { migrationSources } from "../src/infra/migration-sources.js";

/** 仓库根：__tests__ → apps/api → 仓库根。 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("迁移装载（Phase 4 审计表）", () => {
  it("1. audit_log 迁移能被 migrate.ts 的来源清单按 namespace=api 装载", async () => {
    const sources = migrationSources(REPO_ROOT);
    const apiSource = sources.find((s) => s.namespace === "api");
    expect(apiSource).toBeDefined();

    const migrations = await loadMigrationsFromDir(apiSource!.dir, apiSource!.namespace);
    const names = migrations.map((m) => m.name);
    expect(names).toContain("api/0001_audit_log.sql");
  });

  it("2. 审计迁移建表语句幂等（IF NOT EXISTS）且不含破坏性变更", async () => {
    const migrations = await loadMigrationsFromDir(
      join(REPO_ROOT, "apps/api/migrations"),
      "api",
    );
    const audit = migrations.find((m) => m.name.endsWith("0001_audit_log.sql"))!;
    expect(audit).toBeDefined();
    expect(audit.sql).toContain("CREATE TABLE IF NOT EXISTS audit_log");
    expect(audit.sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(audit.sql).not.toMatch(/\bTRUNCATE\b/i);
    // 迁移执行器自行包裹事务，文件内不允许事务控制语句（注释里的说明文字不算）
    const withoutComments = audit.sql.replace(/--[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/\bBEGIN\b/i);
    expect(withoutComments).not.toMatch(/\bCOMMIT\b/i);
  });

  it("3. 审计表字段与需求一致", async () => {
    const migrations = await loadMigrationsFromDir(
      join(REPO_ROOT, "apps/api/migrations"),
      "api",
    );
    const audit = migrations.find((m) => m.name.endsWith("0001_audit_log.sql"))!;
    for (const column of [
      "id",
      "actor_type",
      "actor_id",
      "action",
      "entity_type",
      "entity_id",
      "before",
      "after",
      "ip",
      "user_agent",
      "request_id",
      "created_at",
    ]) {
      expect(audit.sql).toContain(column);
    }
  });

  it("4. 全部迁移来源目录都存在（缺目录会让迁移整体失败）", () => {
    for (const source of migrationSources(REPO_ROOT)) {
      expect(() => loadMigrationsFromDir(source.dir, source.namespace)).not.toThrow();
    }
  });
});

describe("迁移来源清单（防「加了模块忘了加迁移」）", () => {
  it("packages/modules 下每个有 migrations 的模块都在清单里", async () => {
    const { readdirSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { MODULES } = await import("../src/infra/migration-sources.js");
    const root = join(process.cwd(), "..", "..", "packages", "modules");
    const withMigrations = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "migrations")))
      .map((d) => d.name);
    const missing = withMigrations.filter((m) => !MODULES.includes(m));
    expect(missing).toEqual([]);
  });
});
