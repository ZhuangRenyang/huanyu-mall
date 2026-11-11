import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cartCompleteWorkflow } from "@mall/workflows";
import type { AppDeps } from "../../deps.js";
import { mapOrder } from "../mappers.js";
import { auditEntry } from "../audit-context.js";

/**
 * 收货地址：下单时必须带上（ADR-018 的税率按其中的国家解析）。
 * 一期这里曾是 `shippingAddress: {}` 写死——订单根本没有收货地址，是实打实的缺陷。
 */
const completeBody = z
  .object({
    shipping_address: z
      .object({
        name: z.string().max(120).optional(),
        phone: z.string().max(40).optional(),
        country: z.string().max(60).optional(),
        province: z.string().max(80).optional(),
        city: z.string().max(80).optional(),
        address_1: z.string().max(200).optional(),
        address_2: z.string().max(200).optional(),
        postal_code: z.string().max(20).optional(),
      })
      .passthrough()
      .optional(),
  })
  // nullish 而不是 optional：无 body 时 Fastify 传的是 null，
  // 只写 optional 会让老客户端（不带 body 直接 complete）全部 400。
  .nullish();

/** POST /store/carts/{id}/complete — 走 cart-complete workflow + 幂等键（openapi 969）。 */
export function checkoutRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    "/api/v1/store/carts/:id/complete",
    { schema: { body: completeBody } },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    const idempotencyKey = (req.headers["idempotency-key"] as string | undefined) ?? `auto_${id}`;

    /*
     * 幂等重放检测（B2 修复）：下单成功后会作废购物车（软删），
     * 同幂等键重放时 `retrieveCart` 已抛 cartNotFound —— 所以必须先按 cart_id
     * 反查订单：已出过单就直接返回那笔订单，不再走 workflow。
     * 这也顺带兜住了「不同幂等键但车已下单」的情况：返回已有订单而非再出一单，
     * 保证一车一单，杜绝 createPaymentSession 按 cart_id 反查到多笔订单。
     */
    const existingOrders = await deps.services.order.listOrders({ cartId: id });
    if (existingOrders.items.length > 0) {
      const existing = await deps.services.order.retrieveOrder(existingOrders.items[0]!.id);
      reply.code(200).ok(mapOrder(existing));
      return;
    }

    const body = (req.body ?? {}) as z.infer<typeof completeBody>;
    const shippingAddress = body?.shipping_address ?? {};
    // 税率按收货国家解析（ADR-018）：购物车合计与订单税额用同一个国家，前后一致
    const countryCode = (shippingAddress.country as string | undefined) ?? null;
    const cart = await deps.services.cart.retrieveCart(id, { countryCode });
    // 仓选择只由后端 inventory 模块决定（ADR-013 §5 / 铁律 13）：路由不再取仓、不再下发 locationId。

    const input = {
      cartId: id,
      email: cart.email ?? "guest@example.com",
      currencyCode: cart.currency_code,
      channelId: cart.channel_id,
      regionId: cart.region_id,
      shippingAddress,
      shippingMinor: cart.shipping_method?.amount_minor ?? 0n,
      // 税：服务端按国家算好传入（铁律 13，客户端永不传价）
      pricesIncludeTax: cart.tax_included_in_price,
      // 折扣由 cart.retrieveCart 服务端算好（行级 + 订单级），禁客户端传价（铁律 13）。
      discountMinor: cart.totals?.discount_minor ?? 0n,
      // 折扣留痕明细：传给 order 固化进 order_discount 表（资金安全硬约束 5）。
      discounts: (cart.discounts ?? []).map((d) => ({
        type: d.type,
        promotionId: d.promotion_id,
        code: d.code,
        amountMinor: d.amount_minor,
      })),
      items: cart.items.map((li) => ({
        variantId: li.variant_id,
        productId: li.product_id,
        title: li.title,
        sku: li.variant_id,
        quantity: li.quantity,
        unitPriceMinor: li.unit_price_minor,
        snapshot: {},
        taxRateBps: li.tax_rate_bps,
        taxAmountMinor: li.tax_amount_minor,
      })),
    };

    const { result } = await deps.workflow.run(cartCompleteWorkflow, input, { idempotencyKey });

    // 下单成功后作废购物车：一车一单（B2 修复）
    await deps.services.cart.completeCart(id);

    const order = await deps.services.order.retrieveOrder((result as { orderId: string }).orderId);
    const view = mapOrder(order);
    await deps.audit.record(
      auditEntry(req, {
        action: "order.create",
        entityType: "order",
        entityId: order.id,
        after: view,
      }),
    );
    reply.code(201).ok(view);
  });
}
