export interface WorkerConfig {
  redisUrl: string;
  concurrency: number;
  queues: string[];
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    concurrency: Number(env.WORKER_CONCURRENCY ?? 4),
    queues: (env.QUEUES ?? "payment-webhook,order,image,search-index,mail,scheduler")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
