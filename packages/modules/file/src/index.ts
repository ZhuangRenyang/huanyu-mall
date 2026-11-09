import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleFileRepository } from "./repositories/file.repository.js";
import { FileService } from "./services/file.service.js";

export * from "./types.js";
export * from "./errors.js";
export * from "./config.js";
export { linkable } from "./linkable.js";
export { FileService } from "./services/file.service.js";
export { detectImageMime } from "./services/magic.js";

export default Module("file", {
  service: (ctx) =>
    new FileService(new DrizzleFileRepository(createDbFor(ctx.resolve<Pool>("pool"), schema))),
  migrations: ["migrations/0001_init.sql"],
  linkable,
});
