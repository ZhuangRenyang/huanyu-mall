import {
  cartNotFound,
  invalidQuantity,
  lineItemNotFound,
  priceNotFound,
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
    const shipping = await this.deps.repo.findShippingMethod(id);
    /*
     * totals 在**读时动态计算**（不依赖「某次写操作后落库」的时序）：
     * 购物车小计 = Σ(单价×数量)，运费 = 已选方案的规则价，合计 = 小计+运费+税-折扣。
     * 目录促销折扣（阶段 2）也在此动态算：先按商品批量查分类，再调 promotion 端口算行级折扣，
     * 累加进 discount_minor，并把每行折扣金额回填到 items 上（前端展示「原价 → 折后」）。
     * 这是金额的唯一权威算法 —— 任何读方拿到的都是同一份服务端算出的金额。
     */
    const subtotal = this.subtotal(items);
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
        categoryIds: categoryMap.get(i.product_id) ?? [],
        quantity: i.quantity,
        unitPriceMinor: i.unit_price_minor,
      })),
      subtotalMinor: subtotal,
      shippingMinor: shipping?.amount_minor ?? 0n,
      // 只传顾客输入的券码凭证；折扣金额由 promotion 侧算（铁律 13 / 资金安全硬约束 2）。
      voucherCodes: cart.voucher_codes,
      giftCardCodes: cart.gift_card_codes,
    });

    const discountByItem = new Map(discounts.lineAdjustments.map((a) => [a.itemId, a.amountMinor]));
    // discount = 行级折扣合计 + 订单级折扣 + voucher 折扣（阶段 4）+ gift card 抵扣（阶段 5）。
    const lineDiscountMinor = discounts.lineAdjustments.reduce((s, a) => s + a.amountMinor, 0n);
    const discountMinor =
      lineDiscountMinor + discounts.orderDiscountMinor + discounts.voucherDiscountMinor + discounts.giftCardAppliedMinor;

    // 折扣明细（供下单固化 order_discount 留痕）：目录行级折扣按促销聚合 + 订单级折扣。
    const discountDetails = buildDiscountDetails(discounts);

    const totals: CartTotals = {
      subtotal_minor: subtotal,
      shipping_minor: shipping?.amount_minor ?? 0n,
      tax_minor: 0n,
      discount_minor: discountMinor,
      total_minor: subtotal + (shipping?.amount_minor ?? 0n) - discountMinor,
    };
    const enrichedItems: CartLineItemDTO[] = items.map((i) => ({
      ...i,
      discount_minor: discountByItem.get(i.id) ?? 0n,
    }));
    return { ...cart, totals, items: enrichedItems, shipping_method: shipping, discounts: discountDetails };
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

  /** 选运费：客户端只传方案 id，方案名与运费金额一律后端解析（铁律 13）。 */
  async setShippingMethod(cartId: string, input: SetShippingInput): Promise<CartDetailDTO> {
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);
    const option = await this.deps.shipping.findShippingOption(input.shippingOptionId);
    if (!option) throw shippingOptionNotFound(input.shippingOptionId);

    /*
     * 运费金额必须走 calculateShippingPrice（按购物车当前小计算规则价），
     * 而不是直接存 option.amount_minor（方案基础价）。否则：
     * - 列表接口返回的是规则算出的价（free_over 命中 = 0「免运费」），
     * - 这里却存基础价（如 800），
     * 前端展示「免运费」、实际收基础运费 —— 展示价与实收价不一致（收错钱）。
     */
    const items = await this.deps.repo.listLineItems(cartId);
    let subtotal = 0n;
    for (const item of items) subtotal += item.unit_price_minor * BigInt(item.quantity);
    const price = await this.deps.shipping.calculateShippingPrice(input.shippingOptionId, {
      cartSubtotalMinor: subtotal,
    });

    await this.deps.repo.upsertShippingMethod(cartId, {
      shippingOptionId: option.id,
      name: option.name,
      amountMinor: price.amountMinor,
      currencyCode: cart.currency_code,
    });
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

  return out;
}
