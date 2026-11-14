import {
  cartNotFound,
  invalidQuantity,
  invalidShippingCountry,
  lineItemNotFound,
  priceNotFound,
  shippingCountryRequired,
  shippingOptionNotFound,
  variantNotSellable,
} from "../errors.js";
import type {
  AddLineItemInput,
  CartDTO,
  CartDetailDTO,
  CartDiscountDTO,
  CartLineItemDTO,
  CartRepository,
  CartServiceDeps,
  CartTotals,
  CreateCartInput,
  ICartModuleService,
  SetShippingInput,
} from "../types.js";
import { prefixedUlid } from "@mall/core";

/** M04 对外门面（架构 §2.1）。游客车 customer_id=null，cart_customer 无行。 */
export class CartService implements ICartModuleService {
  constructor(private readonly deps: CartServiceDeps) {}

  async createCart(input: CreateCartInput): Promise<CartDTO> {
    const id = prefixedUlid("cart");
    const cart = await this.deps.repo.insert({ ...input, id });
    if (input.customerId) await this.deps.repo.linkCustomer(id, input.customerId);
    return cart;
  }

  async retrieveCart(id: string): Promise<CartDetailDTO> {
    const cart = await this.deps.repo.findById(id);
    if (!cart) throw cartNotFound(id);
    const items = await this.deps.repo.listLineItems(id);
    const subtotal = this.subtotal(items);
    /*
     * 运费**不由客户端选**（ADR-019）：按购物车上的收货国家取可用方案，自动挑最便宜的。
     * 每次都按当前小计重算 —— 方案里可能有「满额免运费」，先选后改数量会让金额过期。
     */
    const shipping = await this.resolveShipping(cart, items);
    /*
     * totals 在**读时动态计算**（不依赖「某次写操作后落库」的时序）：
     * 购物车小计 = Σ(单价×数量)，运费 = 已选方案的规则价，合计 = 小计+运费+税-折扣。
     * 目录促销折扣（阶段 2）也在此动态算：先按商品批量查分类，再调 promotion 端口算行级折扣，
     * 累加进 discount_minor，并把每行折扣金额回填到 items 上（前端展示「原价 → 折后」）。
     * 这是金额的唯一权威算法 —— 任何读方拿到的都是同一份服务端算出的金额。
     */
    const categoryIdsByProduct = await this.deps.product.listCategoryIdsByProducts(
      [...new Set(items.map((i) => i.product_id))],
    );
    const categoryMap = new Map(categoryIdsByProduct.map((c) => [c.productId, c.categoryIds]));

    const discounts = await this.deps.promotion.computeDiscounts({
      currencyCode: cart.currency_code,
      customerId: cart.customer_id,
      items: items.map((i) => ({
        id: i.id,
        variantId: i.variant_id,
        // 指定商品券按它判定命中（ADR-064）
        productId: i.product_id,
        categoryIds: categoryMap.get(i.product_id) ?? [],
        quantity: i.quantity,
        unitPriceMinor: i.unit_price_minor,
      })),
      subtotalMinor: subtotal,
      shippingMinor: shipping?.amount_minor ?? 0n,
      // 只传顾客输入的券码凭证；折扣金额由 promotion 侧算（铁律 13 / 资金安全硬约束 2）。
      voucherCodes: cart.voucher_codes,
      giftCardCodes: cart.gift_card_codes,
      // 积分抵扣意愿：只传点数，抵扣额由 promotion 折算封顶（ADR-094）
      pointsToUse: cart.points_to_use,
    });

    const discountByItem = new Map(discounts.lineAdjustments.map((a) => [a.itemId, a.amountMinor]));
    // discount = 行级折扣合计 + 订单级折扣 + voucher 折扣（阶段 4）+ gift card 抵扣（阶段 5）。
    const lineDiscountMinor = discounts.lineAdjustments.reduce((s, a) => s + a.amountMinor, 0n);
    const discountMinor =
      lineDiscountMinor +
      discounts.orderDiscountMinor +
      discounts.voucherDiscountMinor +
      discounts.giftCardAppliedMinor +
      discounts.pointsAppliedMinor;

    // 折扣明细（供下单固化 order_discount 留痕）：目录行级折扣按促销聚合 + 订单级折扣。
    const discountDetails = buildDiscountDetails(discounts);

    /*
     * 税（ADR-018）：按顾客收货国家解析税率，**折后**行金额计税。
     * 含税价：税已含在价格里，合计不再加；价外税才加——两种口径混了就是重复收税。
     */
    const shippingMinor = shipping?.amount_minor ?? 0n;
    const tax = await this.deps.tax.calculateTax({
      countryCode: cart.shipping_country,
      lines: items.map((i) => ({
        lineId: i.id,
        amountMinor: i.unit_price_minor * BigInt(i.quantity) - (discountByItem.get(i.id) ?? 0n),
      })),
      shippingMinor,
    });

    const totals: CartTotals = {
      subtotal_minor: subtotal,
      shipping_minor: shippingMinor,
      tax_minor: tax.totalTaxMinor,
      shipping_tax_minor: tax.shippingTaxMinor,
      discount_minor: discountMinor,
      total_minor:
        subtotal + shippingMinor - discountMinor + (tax.included_in_price ? 0n : tax.totalTaxMinor),
    };
    const taxByLine = new Map(tax.lines.map((l) => [l.lineId, l]));
    const enrichedItems: CartLineItemDTO[] = items.map((i) => ({
      ...i,
      discount_minor: discountByItem.get(i.id) ?? 0n,
      tax_rate_bps: taxByLine.get(i.id)?.taxRateBps ?? 0,
      tax_amount_minor: taxByLine.get(i.id)?.taxAmountMinor ?? 0n,
    }));
    return {
      ...cart,
      totals,
      items: enrichedItems,
      shipping_method: shipping,
      discounts: discountDetails,
      tax_included_in_price: tax.included_in_price,
    };
  }

  /**
   * 自动选运费：按收货国家列可用方案，挑规则价最低的一个。
   * 没有国家 → 不产生运费（但下单会被 checkout 拒掉）；该国无方案 → null。
   */
  /**
   * 自动算运费（ADR-019 / ADR-021）。
   *
   * 运费**跟着商品走**：先查每个商品的运费模板，再按模板分组，各组分别取最便宜方案后相加。
   * - 标了「卖家包邮」的商品不产生运费，其金额也不计入任何门槛（不能拿包邮品凑满减）；
   * - 某个模板下该国没有可用方案 → 整单返回 null（结账据此挡住，不静默免运费）。
   */
  private async resolveShipping(
    cart: CartDTO,
    items: CartLineItemDTO[],
  ): Promise<CartDetailDTO["shipping_method"]> {
    const country = cart.shipping_country;
    if (!country || items.length === 0) return null;

    const productIds = [...new Set(items.map((i) => i.product_id))];
    const infos = await this.deps.product.listShippingInfoByProducts(productIds);
    const infoByProduct = new Map(infos.map((i) => [i.productId, i]));

    // 按模板聚合「非包邮商品」的小计；包邮商品直接跳过
    const groups = new Map<string | null, bigint>();
    for (const item of items) {
      const info = infoByProduct.get(item.product_id);
      if (info?.freeShipping) continue;
      const profileId = info?.profileId ?? null;
      const line = item.unit_price_minor * BigInt(item.quantity);
      groups.set(profileId, (groups.get(profileId) ?? 0n) + line);
    }

    // 整车都是包邮商品：运费 0，但要给前台一个可展示的说法
    if (groups.size === 0) {
      return {
        id: "auto_free",
        cart_id: cart.id,
        shipping_option_id: "free_shipping",
        name: "卖家包邮",
        amount_minor: 0n,
        currency_code: cart.currency_code,
      };
    }

    const picked = await Promise.all(
      [...groups.entries()].map(async ([profileId, groupSubtotal]) => {
        const options = await this.deps.shipping.listShippingOptions({
          channelId: cart.channel_id,
          countryCode: country,
          cartSubtotalMinor: groupSubtotal,
          profileId,
        });
        if (options.length === 0) return null;

        const priced = await Promise.all(
          options.map(async (option) => ({
            option,
            price: await this.deps.shipping.calculateShippingPrice(option.id, {
              cartSubtotalMinor: groupSubtotal,
            }),
          })),
        );
        // 价格相同按 id 排，保证同一辆车每次算出来一致（避免展示抖动）
        priced.sort((a, b) =>
          a.price.amountMinor !== b.price.amountMinor
            ? a.price.amountMinor < b.price.amountMinor
              ? -1
              : 1
            : a.option.id.localeCompare(b.option.id),
        );
        return priced[0]!;
      }),
    );

    // 任一组发不到这个国家 → 整单不可结（部分可发会让顾客以为能买）
    if (picked.some((p) => p === null)) return null;
    const chosen = picked as NonNullable<(typeof picked)[number]>[];

    const amount = chosen.reduce((sum, c) => sum + c.price.amountMinor, 0n);
    const first = chosen[0]!;
    return {
      id: `auto_${chosen.map((c) => c.option.id).join("_")}`,
      cart_id: cart.id,
      shipping_option_id: first.option.id,
      name: chosen.length === 1 ? first.option.name : `运费（${chosen.length} 个包裹）`,
      amount_minor: amount,
      currency_code: first.price.currencyCode,
    };
  }

  /** 设置收货国家：税与运费都按它算（ADR-019）。 */
  async setShippingCountry(cartId: string, countryCode: string): Promise<CartDetailDTO> {
    const code = countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw invalidShippingCountry(countryCode);
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);
    await this.deps.repo.updateShippingCountry(cartId, code);
    return this.retrieveCart(cartId);
  }

  private subtotal(items: CartLineItemDTO[]): bigint {
    let s = 0n;
    for (const item of items) s += item.unit_price_minor * BigInt(item.quantity);
    return s;
  }

  /** 加购：客户端只传 variantId + quantity；商品标题与单价一律后端解析（铁律 13，防篡改价格）。 */
  async addLineItem(cartId: string, input: AddLineItemInput): Promise<CartDetailDTO> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw invalidQuantity();
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);

    const [variant] = await this.deps.product.listVariantsByIds([input.variantId]);
    if (!variant) throw lineItemNotFound(input.variantId);
    if (variant.status !== "published") throw variantNotSellable(input.variantId);

    const [price] = await this.deps.pricing.calculatePrices({
      variantIds: [input.variantId],
      context: {
        currencyCode: cart.currency_code,
        channelId: cart.channel_id,
        quantity: input.quantity,
      },
    });
    if (!price) throw priceNotFound(input.variantId);

    await this.deps.repo.insertLineItem(cartId, {
      variantId: input.variantId,
      quantity: input.quantity,
      productId: variant.product_id,
      title: variant.title,
      sku: variant.sku,
      unitPriceMinor: price.amountMinor,
      currencyCode: cart.currency_code,
    });
    return this.retrieveCart(cartId);
  }

  async updateLineItem(cartId: string, lineId: string, patch: { quantity: number }): Promise<CartDetailDTO> {
    if (!Number.isInteger(patch.quantity) || patch.quantity <= 0) throw invalidQuantity();
    const line = await this.deps.repo.findLineItem(lineId);
    if (!line) throw lineItemNotFound(lineId);
    await this.deps.repo.updateLineItemQuantity(lineId, patch.quantity);
    return this.retrieveCart(cartId);
  }

  async deleteLineItem(cartId: string, lineId: string): Promise<void> {
    const line = await this.deps.repo.findLineItem(lineId);
    if (!line) throw lineItemNotFound(lineId);
    await this.deps.repo.softDeleteLineItem(lineId);
  }

  /**
   * 运费选择接口（兼容旧客户端）：**不再改变金额**。
   *
   * ADR-019：运费由系统按收货国家自动选最便宜的可用方案，
   * 客户端传什么都只是「确认」，合计永远由 retrieveCart 重算。
   * 仍然做两件校验，避免旧客户端误以为「选了就能便宜」：
   *   1. 必须已经填过收货国家；
   *   2. 传的方案必须在该国家的可用清单里（防止跨区套用低价方案）。
   */
  async setShippingMethod(cartId: string, input: SetShippingInput): Promise<CartDetailDTO> {
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);
    if (!cart.shipping_country) throw shippingCountryRequired();
    const option = await this.deps.shipping.findShippingOption(input.shippingOptionId);
    if (!option) throw shippingOptionNotFound(input.shippingOptionId);
    const available = await this.deps.shipping.listShippingOptions({
      channelId: cart.channel_id,
      countryCode: cart.shipping_country,
      cartSubtotalMinor: 0n,
    });
    if (!available.some((o) => o.id === option.id)) {
      throw shippingOptionNotFound(input.shippingOptionId);
    }
    // 校验通过也不落库：金额以 retrieveCart 的自动选择为准
    return this.retrieveCart(cartId);
  }

  async completeCart(cartId: string): Promise<void> {
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);
    await this.deps.repo.updateStatus(cartId, "completed");
    await this.deps.repo.softDelete(cartId);
  }

  /** 设置顾客输入的 voucher codes（覆盖式，去重；只存凭证，金额由后端算）。 */
  async setVoucherCodes(cartId: string, codes: string[]): Promise<CartDetailDTO> {
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);
    const normalized = [...new Set(codes.filter((c) => typeof c === "string" && c.length > 0))];
    await this.deps.repo.updateVoucherCodes(cartId, normalized);
    return this.retrieveCart(cartId);
  }

  /** 设置顾客输入的 gift card codes（覆盖式，去重；只存凭证，抵扣金额由后端算）。 */
  async setGiftCardCodes(cartId: string, codes: string[]): Promise<CartDetailDTO> {
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);
    const normalized = [...new Set(codes.filter((c) => typeof c === "string" && c.length > 0))];
    await this.deps.repo.updateGiftCardCodes(cartId, normalized);
    return this.retrieveCart(cartId);
  }

  /** 设置积分抵扣意愿（ADR-094）：点数非负，抵扣额由 promotion 折算封顶。 */
  async setPointsToUse(cartId: string, points: bigint): Promise<CartDetailDTO> {
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);
    const normalized = points < 0n ? 0n : points;
    await this.deps.repo.updatePointsToUse(cartId, normalized);
    return this.retrieveCart(cartId);
  }

  async restoreCart(cartId: string): Promise<void> {
    await this.deps.repo.restore(cartId);
    await this.deps.repo.updateStatus(cartId, "open");
  }
}

/**
 * 把 computeDiscounts 结果整理成 order_discount 留痕所需的折扣明细（ADR-012 §3）。
 * - 目录促销：按 promotion_id 聚合行级折扣（同一促销命中多行时合并金额）。
 * - 订单促销：单条（多命中已在 promotion 侧取最大）。
 * - voucher：单条（多码命中已在 promotion 侧取最大），type='voucher'，code=券码。
 * - gift card：多条（多卡顺序累加），type='gift_card'，promotion_id=gift_card_id，code=卡码。
 * code 归一化：空字符串按 null 处理。
 */
function buildDiscountDetails(discounts: {
  lineAdjustments: Array<{ itemId: string; amountMinor: bigint; promotionId: string; code: string }>;
  orderDiscountMinor: bigint;
  orderDiscounts: Array<{ promotionId: string; code: string | null; amountMinor: bigint }>;
  voucherDiscounts: Array<{ promotionId: string; code: string; amountMinor: bigint }>;
  giftCardDiscounts: Array<{ giftCardId: string; code: string; amountMinor: bigint }>;
  pointsAppliedMinor: bigint;
}): CartDiscountDTO[] {
  const out: CartDiscountDTO[] = [];

  const catalogueByPromo = new Map<string, { code: string | null; amountMinor: bigint }>();
  for (const a of discounts.lineAdjustments) {
    const cur = catalogueByPromo.get(a.promotionId) ?? { code: null, amountMinor: 0n };
    cur.amountMinor += a.amountMinor;
    if (a.code) cur.code = a.code;
    catalogueByPromo.set(a.promotionId, cur);
  }
  for (const [promotionId, v] of catalogueByPromo) {
    out.push({ type: "catalogue", promotion_id: promotionId, code: v.code, amount_minor: v.amountMinor });
  }

  for (const od of discounts.orderDiscounts) {
    out.push({ type: "order", promotion_id: od.promotionId, code: od.code, amount_minor: od.amountMinor });
  }

  for (const vd of discounts.voucherDiscounts) {
    out.push({ type: "voucher", promotion_id: vd.promotionId, code: vd.code, amount_minor: vd.amountMinor });
  }

  for (const gd of discounts.giftCardDiscounts) {
    out.push({ type: "gift_card", promotion_id: gd.giftCardId, code: gd.code, amount_minor: gd.amountMinor });
  }

  if (discounts.pointsAppliedMinor > 0n) {
    out.push({ type: "points", promotion_id: "", code: null, amount_minor: discounts.pointsAppliedMinor });
  }

  return out;
}
