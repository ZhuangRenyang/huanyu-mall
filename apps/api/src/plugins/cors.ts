import type { FastifyInstance } from "fastify";

/** CORS：仅允许配置的前端来源；处理 OPTIONS 预检（生产禁止通配符）。 */
export function corsPlugin(app: FastifyInstance, origins: string[]): void {
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      reply.header("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      reply.header(
        "access-control-allow-headers",
        "Content-Type,Authorization,Idempotency-Key,x-publishable-key,x-request-id",
      );
      reply.header("access-control-max-age", "86400");
      reply.code(204).send();
    }
  });
}
