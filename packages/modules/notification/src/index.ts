import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import * as schema from "./models/index.js";
import { DrizzleNotificationRepository } from "./repositories/notification.repository.js";
import { NotificationService } from "./services/notification.service.js";

export * from "./types.js";
export * from "./errors.js";
export { NotificationService } from "./services/notification.service.js";
export { NotificationDispatcher } from "./services/dispatcher.js";
export {
  renderOrderConfirmation,
  renderShipmentNotification,
  escapeHtml,
} from "./services/templates.js";
export { formatMinor } from "./services/money.js";

export default Module("notification", {
  service: (ctx) =>
    new NotificationService(
      new DrizzleNotificationRepository(createDbFor(ctx.resolve<Pool>("pool"), schema)),
    ),
  migrations: ["migrations/0001_init.sql", "migrations/0002_stock_alert.sql", "migrations/0003_refund_update.sql"],
});
