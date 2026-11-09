import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { WorkerConfig } from "../config.js";

/** BullMQ 消费者骨架：不监听 HTTP，只订阅队列（架构 §9.2 / §10.3）。 */
export function createWorkers(config: WorkerConfig): Worker[] {
  return config.queues.map((name) => {
    // 每队列独立连接，避免 worker.close() 关闭共享连接。
    const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

    const worker = new Worker(
      name,
      async (job: Job) => {
        // 骨架占位：后续按队列接入 workflow.run / subscriber 处理
        console.log(
          { queue: name, jobId: job.id, jobName: job.name },
          "worker job processed (skeleton)",
        );
      },
      { connection, concurrency: config.concurrency },
    );

    worker.on("failed", (job, err) => {
      console.error(
        { queue: name, jobId: job?.id, err: err?.message },
        "worker job failed",
      );
    });
    return worker;
  });
}
