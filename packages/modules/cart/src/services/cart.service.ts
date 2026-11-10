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
  CartLineItemDTO,
  CartRepository,
  CartServiceDeps,
  CartShippingMethodDTO,
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
     * 这是金额的唯一权威算法 —— 任何读方（运费列表 free_over、结账下单、支付集合）
     * 拿到的都是同一份服务端算出的金额，杜绝「展示价 ≠ 实收价」。
     */
    return { ...cart, totals: this.computeTotals(items, shipping), items, shipping_method: shipping };
  }

  /** 金额权威计算：小计=Σ(单价×数量)，合计=小计+运费+税-折扣。税/折扣一期恒 0，结构留出。 */
  private computeTotals(items: CartLineItemDTO[], shipping: CartShippingMethodDTO | null): CartTotals {
    let subtotal = 0n;
    for (const item of items) subtotal += item.unit_price_minor * BigInt(item.quantity);
    const shippingMinor = shipping?.amount_minor ?? 0n;
    const taxMinor = 0n;
    const discountMinor = 0n;
    return {
      subtotal_minor: subtotal,
      shipping_minor: shippingMinor,
      tax_minor: taxMinor,
      discount_minor: discountMinor,
      total_minor: subtotal + shippingMinor + taxMinor - discountMinor,
    };
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

  async restoreCart(cartId: string): Promise<void> {
    await this.deps.repo.restore(cartId);
    await this.deps.repo.updateStatus(cartId, "open");
  }
}
