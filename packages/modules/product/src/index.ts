import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleProductRepository } from "./repositories/product.repository.js";
import { DrizzleStockAlertRepository } from "./repositories/stock-alert.repository.js";
import { ProductService } from "./services/product.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { ProductService, STOCK_ALERT_TTL_DAYS } from "./services/product.service.js";
export { seedCatalog, type CatalogSeedPorts } from "./services/seed.js";

export default Module("product", {
  service: (ctx) => {
    const db = createDbFor(ctx.resolve<Pool>("pool"), schema);
    return new ProductService(
      new DrizzleProductRepository(db),
      // 到货提醒（ADR-059）：与商品同库同模块，不新增依赖边
      new DrizzleStockAlertRepository(db),
    );
  },
  migrations: ["migrations/0001_init.sql", "migrations/0002_shipping.sql", "migrations/0003_stock_alert.sql"],
  linkable,
});
