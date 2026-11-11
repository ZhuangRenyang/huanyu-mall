import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import type { CartDetailDTO, CartDiscountDTO, CartLineItemDTO } from "@mall/cart";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers, resolveChannelId } from "../../plugins/auth.js";

const createCartBody = z.object({ email: z.string().email().optional() });
/** 加购只收 variant_id + quantity：价格/标题由后端解析（铁律 13，防客户端篡改价格）。 */
const addLineItemBody = z.object({
  variant_id: z.string(),
  quantity: z.number().int().min(1).max(999),
});
const updateLineItemBody = z.object({ quantity: z.number().int().min(1).max(999) });
/** 选运费只收方案 id：方案名与运费金额由后端解析（铁律 13，防客户端指定运费）。 */
const shippingMethodBody = z.object({
  shipping_option_id: z.string(),
});
/** 输码：只收券码凭证（string[]），折扣金额由后端 computeDiscounts 算（铁律 13，防客户端传价）。 */
const voucherCodesBody = z.object({
  codes: z.array(z.string().min(1)).max(50),
});
/** 输礼品卡码：只收卡码凭证（string[]），抵扣金额由后端 computeDiscounts 算（铁律 13，防客户端传价）。 */
const giftCardCodesBody = z.object({
  codes: z.array(z.string().min(1)).max(50),
});

function mapLineItem(li: CartLineItemDTO) {
  return {
    id: li.id,
    variant_id: li.variant_id,
    product_id: li.product_id,
    title: li.title,
    quantity: li.quantity,
    unit_price_minor: li.unit_price_minor,
    currency_code: li.currency_code,
    line_total_minor: li.unit_price_minor * BigInt(li.quantity),
    // 目录促销行级折扣（阶段 2，前端展示「原价 → 折后」）
    discount_minor: li.discount_minor,
    line_total_after_discount_minor: li.unit_price_minor * BigInt(li.quantity) - li.discount_minor,
    // 行级税（ADR-018）：按收货国家解析，快照进订单后不再随税率调整
    tax_rate_bps: li.tax_rate_bps,
    tax_amount_minor: li.tax_amount_minor,
  };
}

function mapDiscount(d: CartDiscountDTO) {
  return {
    type: d.type,
    promotion_id: d.promotion_id,
    code: d.code,
    amount_minor: d.amount_minor,
  };
}

export function mapCart(cart: CartDetailDTO) {
  return {
    id: cart.id,
    channel_id: cart.channel_id,
    region_id: cart.region_id,
    currency_code: cart.currency_code,
    customer_id: cart.customer_id,
    email: cart.email,
    status: cart.status,
    voucher_codes: cart.voucher_codes,
    gift_card_codes: cart.gift_card_codes,
    line_items: cart.items.map(mapLineItem),
    shipping_method: cart.shipping_method,
    totals: cart.totals,
    // 命中的促销折扣明细（优惠券/礼品卡/订单促销逐项展示「-¥20」「-¥50」用）
    discounts: cart.discounts.map(mapDiscount),
    // 税口径（ADR-018）：true 时合计已含税，前端不要再加一遍
    tax_included_in_price: cart.tax_included_in_price,
  };
}

export function cartRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  app.post(
    "/api/v1/store/carts",
    { preHandler: [auth.customerAuth], schema: { body: createCartBody } },
    async (req, reply) => {
      const body = req.body as { email?: string };
      const channelId = await resolveChannelId(deps, req);
      const channel = await deps.services.regionChannel.getChannel(channelId);
      const cart = await deps.services.cart.createCart({
        channelId,
        regionId: channel.region_id,
        currencyCode: channel.currency_code,
        customerId: req.auth?.sub ?? null,
        email: body.email ?? null,
      });
      reply.code(201).ok(cart);
    },
  );

  // country：税率按收货国家解析（ADR-018）。结账页选了国家就带上，合计实时跟着变。
  app.get("/api/v1/store/carts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { country?: string };
    const cart = await deps.services.cart.retrieveCart(id, { countryCode: q.country ?? null });
    if (cart.customer_id && req.auth?.sub && cart.customer_id !== req.auth.sub) {
      throw errors.forbidden("not your cart");
    }
    reply.ok(mapCart(cart));
  });

  app.post(
    "/api/v1/store/carts/:id/line-items",
    { schema: { body: addLineItemBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof addLineItemBody>;
      const cart = await deps.services.cart.addLineItem(id, {
        variantId: b.variant_id,
        quantity: b.quantity,
      });
      reply.code(201).ok(mapCart(cart));
    },
  );

  app.patch(
    "/api/v1/store/carts/:id/line-items/:lineId",
    { schema: { body: updateLineItemBody } },
    async (req, reply) => {
      const { id, lineId } = req.params as { id: string; lineId: string };
      const b = req.body as { quantity: number };
      const cart = await deps.services.cart.updateLineItem(id, lineId, { quantity: b.quantity });
      reply.ok(mapCart(cart));
    },
  );

  app.delete("/api/v1/store/carts/:id/line-items/:lineId", async (req, reply) => {
    const { id, lineId } = req.params as { id: string; lineId: string };
    await deps.services.cart.deleteLineItem(id, lineId);
    reply.code(204).send();
  });

  app.post(
    "/api/v1/store/carts/:id/shipping-methods",
    { schema: { body: shippingMethodBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof shippingMethodBody>;
      const cart = await deps.services.cart.setShippingMethod(id, {
        shippingOptionId: b.shipping_option_id,
      });
      reply.ok(mapCart(cart));
    },
  );

  // 输码/清码：覆盖式设置顾客输入的 voucher codes（阶段 4，只传凭证）。
  app.put(
    "/api/v1/store/carts/:id/voucher-codes",
    { schema: { body: voucherCodesBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof voucherCodesBody>;
      const cart = await deps.services.cart.setVoucherCodes(id, b.codes);
      reply.ok(mapCart(cart));
    },
  );

  // 输礼品卡码/清码：覆盖式设置（阶段 5，只传凭证，抵扣由后端算）。
  app.put(
    "/api/v1/store/carts/:id/gift-card-codes",
    { schema: { body: giftCardCodesBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof giftCardCodesBody>;
      const cart = await deps.services.cart.setGiftCardCodes(id, b.codes);
      reply.ok(mapCart(cart));
    },
  );
}
