import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzlePromotionRepository } from "./repositories/promotion.repository.js";
import { PromotionService } from "./services/promotion.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { PromotionService } from "./services/promotion.service.js";
export { evalPredicate, type PredicateContext } from "./services/predicate.js";

export default Module("promotion", {
  service: (ctx) =>
    new PromotionService(new DrizzlePromotionRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: [
    "migrations/0001_init.sql",
    "migrations/0002_features.sql",
    "migrations/0003_voucher_collection.sql",
    "migrations/0004_voucher_scope.sql",
    // 0005/0006 此前建了文件却漏注册（ADR-085/ADR-086 的存量缺陷），一并补上
    "migrations/0005_voucher_valid_days.sql",
    "migrations/0006_voucher_tiers.sql",
    "migrations/0012_voucher_scope_mode.sql",
    "migrations/0013_points.sql",
  ],
  linkable,
});
