import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config.js";
import { checkHealth } from "../services/health.js";

export function healthRoutes(app: FastifyInstance, config: ApiConfig): void {
  app.get("/api/v1/health", async () => {
    const data = await checkHealth(config);
    // 健康检查恒 200：db/redis 未连时返回 degraded，端点必须可响应。
    return { code: 0, data, message: "" };
  });
}
