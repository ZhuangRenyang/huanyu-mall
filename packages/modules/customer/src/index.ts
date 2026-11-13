import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleCustomerRepository } from "./repositories/customer.repository.js";
import { CustomerService } from "./services/customer.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { CustomerService } from "./services/customer.service.js";

export default Module("customer", {
  service: (ctx) =>
    new CustomerService(new DrizzleCustomerRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: [
    "migrations/0001_init.sql",
    "migrations/0002_phone_signup.sql",
    "migrations/0003_cn_address.sql",
    "migrations/0004_favorites.sql",
  ],
  linkable,
});
