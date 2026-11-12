import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleProductRepository } from "./repositories/product.repository.js";
import { ProductService } from "./services/product.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { ProductService } from "./services/product.service.js";
export { seedCatalog, type CatalogSeedPorts } from "./services/seed.js";

export default Module("product", {
  service: (ctx) =>
    new ProductService(new DrizzleProductRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: ["migrations/0001_init.sql", "migrations/0002_shipping.sql"],
  linkable,
});
