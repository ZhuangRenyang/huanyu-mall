import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleOrderRepository } from "./repositories/order.repository.js";
import { OrderService } from "./services/order.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { OrderService } from "./services/order.service.js";
export { assertTransition, canTransition, isRefundable } from "./services/state-machine.js";

export default Module("order", {
  service: (ctx) =>
    new OrderService(new DrizzleOrderRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: ["migrations/0001_init.sql", "migrations/0002_order_discount.sql", "migrations/0003_merchant_note.sql", "migrations/0004_refund_request.sql"],
  linkable,
});
