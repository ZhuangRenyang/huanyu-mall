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

export default Module("promotion", {
  service: (ctx) =>
    new PromotionService(new DrizzlePromotionRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: ["migrations/0001_init.sql"],
  linkable,
});
