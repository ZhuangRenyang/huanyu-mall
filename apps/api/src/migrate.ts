import {
  MigrationRunner,
  createLogger,
  createPool,
  loadMigrationsFromDir,
} from "@mall/core";
import { migrationSources } from "./infra/migration-sources.js";

// 迁移入口（install.sh 步骤 7 / compose migrator 服务调用）。
// 用直连 PG（非 PgBouncer）：advisory lock 与迁移事务需要直连会话。
const logger = createLogger({ level: process.env.LOG_LEVEL ?? "info" });

const REPO_ROOT = process.env.MALL_REPO ?? process.cwd();

async function main(): Promise<void> {
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error("缺少 DATABASE_URL / MIGRATION_DATABASE_URL");
    process.exit(1);
  }

  const pool = createPool({ connectionString, max: 1 });
  try {
    const migrations = [];
    for (const source of migrationSources(REPO_ROOT)) {
      migrations.push(
        ...(await loadMigrationsFromDir(source.dir, source.namespace)),
      );
    }

    const runner = new MigrationRunner(pool);
    const results = await runner.run(migrations);
    const applied = results.filter((r) => r.applied).length;
    logger.info(
      `迁移完成：共 ${results.length} 个文件，本次新应用 ${applied} 个`,
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err: unknown) => {
  logger.error(`迁移失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
