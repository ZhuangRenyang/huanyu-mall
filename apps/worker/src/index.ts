import { loadWorkerConfig } from "./config.js";
import { createWorkers } from "./workers/index.js";

const config = loadWorkerConfig();
const workers = createWorkers(config);

async function shutdown(): Promise<void> {
  await Promise.all(workers.map((w) => w.close().catch(() => {})));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`worker started (skeleton, no HTTP): queues=${config.queues.join(",")}`);
