import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { DomainError, WorkflowFailedError } from "@mall/core";
import { setupResponse } from "../src/plugins/response.js";

describe("统一错误映射：workflow 包装的业务错误要拆包", () => {
  it("WorkflowFailedError(cause=DomainError 30003) → 409 + 业务码，而不是 500", async () => {
    const app = Fastify();
    setupResponse(app);
    app.get("/boom", async () => {
      throw new WorkflowFailedError(
        new DomainError({ code: 30003, message: "库存不足：需要 5 仅有 4" }),
        "wf_test",
      );
    });
    try {
      const res = await app.inject({ method: "GET", url: "/boom" });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(30003);
      expect(res.json().message).toContain("库存不足");
    } finally {
      await app.close();
    }
  });

  it("裸 DomainError 仍按原逻辑映射（回归）", async () => {
    const app = Fastify();
    setupResponse(app);
    app.get("/plain", async () => {
      throw new DomainError({ code: 20001, message: "参数校验失败" });
    });
    try {
      const res = await app.inject({ method: "GET", url: "/plain" });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(20001);
    } finally {
      await app.close();
    }
  });
});
