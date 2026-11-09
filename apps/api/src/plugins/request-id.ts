import type { FastifyInstance } from "fastify";

/** requestId 回显（与日志 reqId 一致）。直接装配在根 app。 */
export function setupRequestId(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
}
