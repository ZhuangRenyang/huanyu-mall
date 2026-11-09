import { createPool } from "@mall/core";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createRealDeps } from "./deps.js";

const config = loadConfig();
const pool = createPool({ connectionString: config.databaseUrl });
const deps = createRealDeps(pool, config);
const app = await buildApp(deps);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
