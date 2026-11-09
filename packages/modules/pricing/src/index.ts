import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzlePricingRepository } from "./repositories/pricing.repository.js";
import { PricingService } from "./services/pricing.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { PricingService } from "./services/pricing.service.js";
export { selectPrice } from "./services/price-calculator.js";

export default Module("pricing", {
  service: (ctx) =>
    new PricingService(new DrizzlePricingRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: ["migrations/0001_init.sql"],
  linkable,
});
