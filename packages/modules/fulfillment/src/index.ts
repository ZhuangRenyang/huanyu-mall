import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleFulfillmentRepository } from "./repositories/fulfillment.repository.js";
import { FulfillmentService } from "./services/fulfillment.service.js";
import type { InventoryPort, ReservationDTO } from "./types.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { FulfillmentService } from "./services/fulfillment.service.js";
export { calculateShipping } from "./services/shipping-calculator.js";

export default Module("fulfillment", {
  service: (ctx) => {
    const inventory = ctx.resolve<{
      commitReservation(id: string): Promise<void>;
      listReservationsByOrder(orderId: string): Promise<ReservationDTO[]>;
    }>("inventory");
    const inventoryPort: InventoryPort = {
      commitReservation: (id) => inventory.commitReservation(id),
      listReservationsByOrder: (orderId) => inventory.listReservationsByOrder(orderId),
    };
    return new FulfillmentService({
      repo: new DrizzleFulfillmentRepository(createDbFor(ctx.resolve<Pool>("pool"), schema)),
      inventory: inventoryPort,
    });
  },
  migrations: ["migrations/0001_init.sql", "migrations/0002_location.sql"],
  linkable,
});
