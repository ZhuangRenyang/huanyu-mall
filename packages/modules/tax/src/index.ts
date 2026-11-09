import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleTaxRepository } from "./repositories/tax.repository.js";
import { TaxService } from "./services/tax.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { TaxService } from "./services/tax.service.js";
export { taxFor } from "./services/tax-calculator.js";

export default Module("tax", {
  service: (ctx) =>
    new TaxService(new DrizzleTaxRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: ["migrations/0001_init.sql"],
  linkable,
});
