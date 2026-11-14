import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import { cartCompleteWorkflow } from "@mall/workflows";
import type { AppDeps } from "../../deps.js";
import { mapOrder } from "../mappers.js";
import { auditEntry } from "../audit-context.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

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
    /*
     * 顾客留言（淘宝「给卖家留言」，ADR-050）。
     *
     * 这里**宽进**（1000）而服务层**严存**（截断到 200）：顾客已经点了一次下单，
     * 为一个备注把他 400 回去，他得重填地址、重选券，代价远大于截掉几行字。
     * 1000 只是防滥用的粗护栏，别让请求体无上限。
     */
    customer_note: z.string().max(1000).nullish(),
    /**
     * 推广码（分销归因，ADR-101）。
     *
     * 只收**码**不收 affiliate_id：id 是内部标识，客户端传什么就是什么，
     * 等于让任何人把订单挂到别人名下。码要服务端查表并校验状态。
     */
    affiliate_code: z.string().max(32).nullish(),
  })
  // nullish 而不是 optional：无 body 时 Fastify 传的是 null，
  // 只写 optional 会让老客户端（不带 body 直接 complete）全部 400。
  .nullish();

/**
 * 店面可选国家/地区（ADR-018 / ADR-019）。
 *
 * 两个来源各管一件事，不能混：
 * - **能不能卖到该国** = 运费覆盖范围（fulfillment）。没配运费就不该让顾客选，
 *   否则他填完地址、点下单才被「无可用运费方案」挡住。
 * - **该国收多少税** = 税率配置（tax）。
 *
 * 之前这份清单只取税务、且写死「中国」一条，等于用税表冒充配送范围；
 * 现在以配送范围为准，税务信息只做附加字段。
 *
 * 一个区都没配（新装店铺）时返回空列表 + `shipping_configured: false`，
 * 前台据此提示「暂无可配送地区」，而不是让顾客在空下拉里打转。
 */
export function checkoutMetadataRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/v1/store/checkout/countries", async (_req, reply) => {
    const [taxCountries, deliverable] = await Promise.all([
      deps.services.tax.listCheckoutCountries(),
      deps.services.fulfillment.listDeliverableCountries(),
    ]);
    const allowed = new Set(deliverable);
    const items = taxCountries.filter((c) => allowed.has(c.code));
    reply.ok({
      items,
      count: items.length,
      shipping_configured: deliverable.length > 0,
      // 默认国家：优先中国（既有店铺的主市场），否则列表第一个
      default_country: items.find((c) => c.code === "CN")?.code ?? items[0]?.code ?? null,
    });
  });
}

/** POST /store/carts/{id}/complete — 走 cart-complete workflow + 幂等键（openapi 969）。 */
export function checkoutRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  app.post(
    "/api/v1/store/carts/:id/complete",
    // 可选解析：登录了订单归到顾客名下，未登录仍允许游客下单
    { preHandler: auth.customerAuth, schema: { body: completeBody } },
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
    const provided = body?.shipping_address ?? {};
    /*
     * 金额口径只认购物车上存的收货国家（ADR-019）：
     * - 请求体里的 country 只用于「与购物车核对」，不参与任何计价；
     * - 没有国家就拒绝下单——否则会走默认税率，成了「不填地址就少交税」的绕过口子；
     * - 该国没有可用运费方案也拒绝：不能按 0 运费把货发到不配送的地区。
     */
    const cart = await deps.services.cart.retrieveCart(id);
    const country = cart.shipping_country;
    if (!country) throw errors.validation("请先填写收货国家/地区");
    const providedCountry = provided.country?.trim().toUpperCase();
    if (providedCountry && providedCountry !== country) {
      throw errors.validation(
        `收货国家与购物车不一致（购物车为 ${country}）：请回到收货地址重新确认`,
      );
    }
    if (!cart.shipping_method) {
      throw errors.validation(`该地区暂不支持配送（${country}）`);
    }
    // 订单地址 = 客户填写详情 + 购物车里的国家（国家以服务端为准）
    const shippingAddress = { ...provided, country };
    // 仓选择只由后端 inventory 模块决定（ADR-013 §5 / 铁律 13）：路由不再取仓、不再下发 locationId。

    /*
     * 分销归因（ADR-101）：推广码只在服务端解析。
     * 码无效/已停用 → 静默按自然流量处理，不挡住下单 ——
     * 顾客不该因为别人发了个过期码就买不了东西。
     */
    const affiliate = body?.affiliate_code
      ? await deps.services.promotion.resolveAffiliateByCode(body.affiliate_code)
      : null;

    const input = {
      cartId: id,
      email: cart.email ?? "guest@example.com",
      // 归属取 token 里的 customerId（不是 body）：客户端传谁就是谁，等于没有归属
      customerId: req.auth?.customerId ?? null,
      currencyCode: cart.currency_code,
      channelId: cart.channel_id,
      regionId: cart.region_id,
      shippingAddress,
      shippingMinor: cart.shipping_method?.amount_minor ?? 0n,
      // 运费的税：不传就等于少收一份（购物车含、订单不含）
      shippingTaxMinor: cart.totals?.shipping_tax_minor ?? 0n,
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
      // 推广归类（ADR-101）：只记归属，不影响金额
      affiliateId: affiliate?.id ?? null,
      // 秒杀行（ADR-099）：下单成功后按它扣活动库存（卖完即止，售罄整单回滚）
      flashItems: (cart.flash_items ?? []).map((f) => ({
        flashSaleItemId: f.flash_sale_item_id,
        quantity: f.quantity,
      })),
      // 顾客留言：可见范围是「顾客自己 + 商家」，与商家内部备注（仅后台）相反。
      customerNote: body?.customer_note ?? null,
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
