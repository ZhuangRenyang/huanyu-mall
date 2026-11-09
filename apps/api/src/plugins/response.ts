import type { FastifyInstance, FastifyReply } from "fastify";
import { httpStatusFor, isDomainError } from "@mall/core";
import type { Envelope, FieldError } from "@mall/types";

declare module "fastify" {
  interface FastifyReply {
    ok<T>(data: T): FastifyReply;
  }
}

/** 统一响应封装 + 错误映射（架构 §7.3 / §7.4）。直接在根 app 上装配（不走插件避免封装隔离）。 */
export function setupResponse(app: FastifyInstance): void {
  app.decorateReply("ok", function (this: FastifyReply, data: unknown) {
    return this.send({ code: 0, data, message: "" } satisfies Envelope);
  });

  // 金额 bigint 不能直接 JSON 序列化 → 全局转 number（int64 范围内安全）
  app.addHook("preSerialization", async (_req, _reply, payload) => bigintToNumber(payload));

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id;
    if (isDomainError(err)) {
      const status = httpStatusFor(err.code);
      const body: Envelope = {
        code: err.code,
        data: null,
        message: err.message,
        requestId,
        ...(err.details !== undefined ? { details: err.details as FieldError[] } : {}),
      };
      return reply.code(status).send(body);
    }

    const errObj = err as { validation?: unknown; name?: string; code?: string; statusCode?: number };
    if (errObj.validation || errObj.name === "ZodError" || errObj.code === "FST_ERR_VALIDATION") {
      return reply.code(400).send({
        code: 20001,
        data: null,
        message: "参数校验失败",
        requestId,
        details: errObj.validation,
      });
    }

    // 请求体超过大小限制：返回 413 而不是笼统的 500（bodyLimit 由 config.security 控制）。
    if (errObj.code === "FST_ERR_CTP_BODY_TOO_LARGE" || errObj.statusCode === 413) {
      return reply.code(413).send({
        code: 20001,
        data: null,
        message: "请求体超出允许的大小限制",
        requestId,
      });
    }

    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: 50001, data: null, message: "内部错误", requestId });
  });
}

/** 递归把 bigint 转为 number（JSON 序列化安全；金额 int64 范围内）。 */
function bigintToNumber(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(bigintToNumber);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = bigintToNumber(val);
    return out;
  }
  return value;
}
