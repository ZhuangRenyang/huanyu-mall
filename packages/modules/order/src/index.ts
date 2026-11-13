import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleOrderRepository } from "./repositories/order.repository.js";
import { OrderService } from "./services/order.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { OrderService, MONTHLY_SOLD_DAYS, monthlySoldSince } from "./services/order.service.js";
export { assertTransition, canTransition, isRefundable } from "./services/state-machine.js";

export default Module("order", {
  service: (ctx) =>
    new OrderService(new DrizzleOrderRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: ["migrations/0001_init.sql", "migrations/0002_order_discount.sql", "migrations/0003_merchant_note.sql", "migrations/0004_refund_request.sql", "migrations/0005_refund_pending.sql", "migrations/0006_customer_index.sql", "migrations/0007_customer_note.sql", "migrations/0008_return_refund.sql", "migrations/0009_return_address_snapshot.sql"],
  linkable,
});
