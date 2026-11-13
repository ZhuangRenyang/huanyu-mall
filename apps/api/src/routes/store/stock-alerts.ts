import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/**
 * 到货提醒登记（ADR-059）。
 *
 * 售罄商品页此前是死胡同：顾客看到「已售罄」只能关页面。
 * 这里给他一个「补货了发我邮箱」的按钮，把一个已经流失的访客留下。
 *
 * 三条规则：
 * 1. **货已经有了就不登记**：让顾客等一封「已到货」的邮件，而商品页明明能直接买，是耍人；
 * 2. 登录顾客用账号邮箱，游客必须自己填（售罄页大部分访客没账号）；
 * 3. 重复登记幂等：同一变体 + 同一邮箱只有一条，前端可以放心重试。
 */
const subscribeBody = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  /** 游客必填；登录顾客可省略（取账号邮箱）。 */
  email: z.string().email().max(160).optional(),
});

export function storeStockAlertRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  app.post(
    "/api/v1/store/stock-alerts",
    { preHandler: auth.customerAuth, schema: { body: subscribeBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof subscribeBody>;
      const customerId =
        req.auth && req.auth.scope === "customer" ? req.auth.customerId : null;

      let email = b.email?.trim().toLowerCase() ?? "";
      if (!email && customerId) {
        // 登录顾客没填邮箱：直接用账号邮箱，别让他再打一遍
        const customer = await deps.services.customer
          .retrieveCustomer(customerId)
          .catch(() => null);
        email = customer?.email?.trim().toLowerCase() ?? "";
      }
      if (!email) throw errors.validation("请填写邮箱，补货后我们发邮件通知你");

      // 有货就别登记 —— 让顾客等一封「已到货」，而商品页明明能买，是耍人
      const [availability] = await deps.services.inventory.getAvailability({
        variantIds: [b.variant_id],
      });
      if (availability && availability.available > 0) {
        throw errors.validation("该规格现在有货，可以直接下单");
      }

      const alert = await deps.services.product.subscribeStockAlert({
        productId: b.product_id,
        variantId: b.variant_id,
        email,
        customerId,
      });
      reply.code(201).ok({
        id: alert.id,
        variant_id: alert.variant_id,
        // 回显脱敏后的邮箱，让顾客确认「发到这个地址」
        email: maskEmail(alert.email),
      });
    },
  );
}

/** zhangsan@example.com → z***@example.com（页面回显用，不必把完整邮箱打到屏幕上）。 */
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const head = name?.slice(0, 1) ?? "";
  return `${head}***@${domain}`;
}
