import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 业务模块（迁移 namespace 与目录名一致）。 */
export const MODULES = [
  "region-channel",
  "product",
  "pricing",
  "tax",
  "customer",
  "file",
  "auth",
  "inventory",
  "cart",
  "promotion",
  "order",
  "payment",
  "fulfillment",
  "theme",
];

export interface MigrationSource {
  /** 迁移目录绝对路径。 */
  dir: string;
  /** schema_migrations 里的唯一前缀，避免同名文件互相覆盖。 */
  namespace: string;
}

/**
 * API 层自己的迁移目录（apps/api/migrations，如 audit_log 审计表）。
 * 优先按仓库根解析；仓库根未指向仓库时回落到本文件相对路径
 * （源码 apps/api/src/migrate.ts 与产物 apps/api/dist/migrate.js 都能解析到同一目录）。
 */
export function apiMigrationsDir(repoRoot: string): string {
  const fromRepoRoot = join(repoRoot, "apps/api/migrations");
  if (existsSync(fromRepoRoot)) return fromRepoRoot;
  return fileURLToPath(new URL("../migrations", import.meta.url));
}

/** 全部迁移来源（执行顺序 = 此数组顺序）。 */
export function migrationSources(repoRoot: string): MigrationSource[] {
  return [
    { dir: join(repoRoot, "packages/core/migrations"), namespace: "core" },
    { dir: join(repoRoot, "packages/links/migrations"), namespace: "links" },
    { dir: apiMigrationsDir(repoRoot), namespace: "api" },
    ...MODULES.map((mod) => ({
      dir: join(repoRoot, `packages/modules/${mod}/migrations`),
      namespace: mod,
    })),
  ];
}
