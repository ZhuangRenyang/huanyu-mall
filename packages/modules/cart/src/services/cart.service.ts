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
    return { ...cart, items, shipping_method: shipping };
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
    await this.deps.repo.upsertShippingMethod(cartId, {
      shippingOptionId: option.id,
      name: option.name,
      amountMinor: option.amount_minor,
      currencyCode: cart.currency_code,
    });
    return this.retrieveCart(cartId);
  }

  async applyTotals(cartId: string, totals: CartTotals): Promise<CartDTO> {
    const cart = await this.deps.repo.findById(cartId);
    if (!cart) throw cartNotFound(cartId);
    await this.deps.repo.updateTotals(cartId, totals);
    const updated = await this.deps.repo.findById(cartId);
    return updated!;
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
