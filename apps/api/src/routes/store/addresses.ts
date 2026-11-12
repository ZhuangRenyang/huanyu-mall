import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/**
 * 顾客地址簿（店面）。
 *
 * 全部要求登录：地址含姓名、电话、门牌，不能像商品一样匿名可读。
 * 归属只认 token 里的 customerId —— 不接受 body/query 传 customer_id，
 * 否则改个参数就能读写别人的地址。
 *
 * 字段口径（ADR-026）：只强制「收件人 + 详细地址 + 国家」。
 * 中文地址不拆姓/名，「省市区」整串放 province，city / postal_code 可省 ——
 * 逼顾客填邮编只会得到一串假数据。
 */
const addressBody = z.object({
  first_name: z.string().min(1).max(60),
  last_name: z.string().max(60).optional(),
  phone: z.string().max(30).optional(),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  province: z.string().max(80).optional(),
  postal_code: z.string().max(20).optional(),
  country_code: z.string().length(2),
  is_default_shipping: z.boolean().optional(),
  is_default_billing: z.boolean().optional(),
});

/** 取当前登录顾客；未登录直接 401。 */
function requireCustomerId(req: FastifyRequest): string {
  if (!req.auth || req.auth.scope !== "customer" || !req.auth.customerId) {
    throw errors.unauthenticated("请先登录");
  }
  return req.auth.customerId;
}

export function storeAddressRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  app.get("/api/v1/store/customer/addresses", { preHandler: auth.customerAuth }, async (req, reply) => {
    const customerId = requireCustomerId(req);
    const items = await deps.services.customer.listAddresses(customerId);
    reply.ok({ items, count: items.length });
  });

  app.post(
    "/api/v1/store/customer/addresses",
    { preHandler: auth.customerAuth, schema: { body: addressBody } },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const b = req.body as z.infer<typeof addressBody>;
      const address = await deps.services.customer.addAddress(customerId, {
        firstName: b.first_name,
        lastName: b.last_name,
        phone: b.phone,
        line1: b.line1,
        line2: b.line2,
        city: b.city,
        province: b.province,
        postalCode: b.postal_code,
        countryCode: b.country_code.toUpperCase(),
        isDefaultShipping: b.is_default_shipping,
        isDefaultBilling: b.is_default_billing,
      });
      reply.code(201).ok(address);
    },
  );

  app.patch(
    "/api/v1/store/customer/addresses/:id",
    { preHandler: auth.customerAuth, schema: { body: addressBody.partial() } },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<ReturnType<typeof addressBody.partial>>;
      const address = await deps.services.customer.updateAddress(customerId, id, {
        ...(b.first_name !== undefined ? { firstName: b.first_name } : {}),
        ...(b.last_name !== undefined ? { lastName: b.last_name } : {}),
        ...(b.phone !== undefined ? { phone: b.phone } : {}),
        ...(b.line1 !== undefined ? { line1: b.line1 } : {}),
        ...(b.line2 !== undefined ? { line2: b.line2 } : {}),
        ...(b.city !== undefined ? { city: b.city } : {}),
        ...(b.province !== undefined ? { province: b.province } : {}),
        ...(b.postal_code !== undefined ? { postalCode: b.postal_code } : {}),
        ...(b.country_code !== undefined ? { countryCode: b.country_code.toUpperCase() } : {}),
        ...(b.is_default_shipping !== undefined
          ? { isDefaultShipping: b.is_default_shipping }
          : {}),
        ...(b.is_default_billing !== undefined ? { isDefaultBilling: b.is_default_billing } : {}),
      });
      reply.ok(address);
    },
  );

  /**
   * 设为默认地址。
   *
   * 做成独立动作而不是 PATCH 一个布尔值：淘宝地址簿上就是一颗「设为默认」按钮，
   * 也能挡住前端传 false 把唯一的默认地址清成「没有默认」。
   */
  app.post(
    "/api/v1/store/customer/addresses/:id/default",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
      const customerId = requireCustomerId(req);
      const { id } = req.params as { id: string };
      reply.ok(await deps.services.customer.setDefaultAddress(customerId, id));
    },
  );

  /**
   * 删除地址。
   *
   * 服务层签名是 `deleteAddress(customerId, addressId)` —— customerId 一并传入，
   * 天然挡住「删别人的地址」，不用在路由里再查一次归属。
   */
  app.delete(
    "/api/v1/store/customer/addresses/:id",
    { preHandler: auth.customerAuth },
    async (req, reply) => {
    const customerId = requireCustomerId(req);
    const { id } = req.params as { id: string };
    await deps.services.customer.deleteAddress(customerId, id);
    reply.code(204).send();
    },
  );
}
