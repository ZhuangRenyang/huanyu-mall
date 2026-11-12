import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/**
 * 当前顾客资料（店面）。
 *
 * 登录响应里只有 token，没有顾客信息；刷新页面后要恢复「我是谁」，
 * 又不想把 email 写死在 localStorage 里当真相 —— 由服务端按 token 回读。
 */
function requireCustomerId(req: FastifyRequest): string {
  if (!req.auth || req.auth.scope !== "customer" || !req.auth.customerId) {
    throw errors.unauthenticated("请先登录");
  }
  return req.auth.customerId;
}

export function storeCustomerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  app.get("/api/v1/store/customer/me", { preHandler: auth.customerAuth }, async (req, reply) => {
    const customerId = requireCustomerId(req);
    const c = await deps.services.customer.retrieveCustomer(customerId);
    reply.ok({
      id: c.id,
      email: c.email,
      first_name: c.first_name,
      last_name: c.last_name,
      phone: c.phone,
    });
  });
}
