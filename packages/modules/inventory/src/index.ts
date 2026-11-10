import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleInventoryRepository } from "./repositories/inventory.repository.js";
import { InventoryService } from "./services/inventory.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { InventoryService } from "./services/inventory.service.js";
export { planAllocation } from "./services/allocation.js";
export type {
  AllocationItem,
  LevelSnapshot,
  AllocationPlan,
  PlannedAllocation,
} from "./services/allocation.js";

export default Module("inventory", {
  service: (ctx) =>
    new InventoryService(new DrizzleInventoryRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: ["migrations/0001_init.sql", "migrations/0003_transfer.sql"],
  linkable,
});
