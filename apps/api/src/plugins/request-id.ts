import type { FastifyInstance } from "fastify";

/**
 * requestId 回显（与日志 reqId 一致）。直接装配在根 app。
 *
 * 用 `onRequest` 而不是 `onSend`：Fastify 5.12.8 下**多个 onSend 钩子同时设响应头**
 * 会触发二次 writeHead（表现为 `ERR_HTTP_HEADERS_SENT` + 每个请求刷一条错误日志，
 * 偶发把 200 变成 500）。实测对照：两个钩子都在 onSend → 报错；都改 onRequest → 正常；
 * 即使在 onSend 里改用 `reply.raw.setHeader` 也仍然报错，说明与设头方式无关，
 * 是 onSend 阶段多次设头本身的问题。
 * onRequest 阶段 `req.id` 已生成，且响应头尚未锁定，是更合适的时机。
 */
export function setupRequestId(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
}
