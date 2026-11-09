import { createLogger, createPool } from "@mall/core";
import { seed as seedRegionChannel } from "@mall/region-channel";
import { loadConfig } from "./config.js";
import { createRealDeps } from "./deps.js";

// 种子入口（install.sh 步骤 8 / compose 一次性调用）：
// region + channel → admin 角色 → 初始管理员。靠 seed_versions / 自然键幂等，可重复执行。

// 交付型默认凭据：单商户开箱即用，安装者无需翻日志即可登录。
// 产品决策：不强制首登改密（谁用想改就改），但安装时可用 --admin-password / ADMIN_PASSWORD 覆盖为强密码。
const DEFAULT_ADMIN_EMAIL = "admin";
const DEFAULT_ADMIN_PASSWORD = "123456";

const logger = createLogger({ level: process.env.LOG_LEVEL ?? "info" });

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error("缺少 DATABASE_URL");
    process.exit(1);
  }

  const pool = createPool({ connectionString, max: 1 });
  try {
    // 1) 全球化主轴：1 Region(CN/CNY) + 1 Channel(cn)
    await seedRegionChannel(pool);
    logger.info("region/channel 种子完成");

    // 2) 初始管理员（admin 角色 + admin_user + identity + credential）
    const adminEmail = process.env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
    const usingDefaultPassword = !process.env.ADMIN_PASSWORD;
    const deps = createRealDeps(pool, loadConfig());
    await deps.services.auth.createAdminUser({
      email: adminEmail,
      password: adminPassword,
      name: "Admin",
    });
    logger.info(`管理员创建完成: ${adminEmail}`);
    if (usingDefaultPassword) {
      logger.warn(`当前使用默认密码 "${DEFAULT_ADMIN_PASSWORD}"，可在后台自行修改（不强制改密）`);
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err: unknown) => {
  const cause = err instanceof Error ? (err as Error & { cause?: Error }).cause : undefined;
  logger.error(
    `种子失败: ${err instanceof Error ? err.message : String(err)}` +
      (cause?.message ? ` | cause: ${cause.message}` : ""),
  );
  process.exit(1);
});
