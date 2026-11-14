import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleThemeRepository } from "./repositories/theme.repository.js";
import { ThemeService } from "./services/theme.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { ThemeService, normalizeLink } from "./services/theme.service.js";
export * from "./home-modules.js";

export default Module("theme", {
  service: (ctx) =>
    new ThemeService(new DrizzleThemeRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: [
    "migrations/0001_init.sql",
    "migrations/0002_store_profile.sql",
    "migrations/0003_announcement.sql",
    "migrations/0003_return_address.sql",
    "migrations/0005_banner.sql",
    "migrations/0006_micro_page.sql",
  ],
  linkable,
});
