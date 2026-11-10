import { describe, expect, it } from "vitest";
import { CartService } from "../src/services/cart.service.js";
import type {
  CartDTO,
  CartLineItemDTO,
  CartRepository,
  CartShippingMethodDTO,
  CartStatus,
  CreateCartInput,
  PricingLookupPort,
  ProductLookupPort,
  PromotionLookupPort,
  ResolvedLineItem,
  SetShippingInput,
  ShippingLookupPort,
  ShippingMethodInput,
} from "../src/types.js";

class InMemoryCartRepository implements CartRepository {
  readonly carts = new Map<string, CartDTO>();
  readonly deleted = new Set<string>();
  readonly items: CartLineItemDTO[] = [];
  readonly deletedItems = new Set<string>();
  readonly shipping = new Map<string, CartShippingMethodDTO>();
  readonly customerLinks = new Map<string, string>();
  private counter = 0;

  async insert(input: CreateCartInput & { id: string }): Promise<CartDTO> {
    const dto: CartDTO = {
      id: input.id,
      channel_id: input.channelId,
      region_id: input.regionId,
      currency_code: input.currencyCode,
      customer_id: input.customerId ?? null,
      email: input.email ?? null,
      status: "open",
      totals: null,
    };
    this.carts.set(dto.id, dto);
    return dto;
  }
  async findById(id: string): Promise<CartDTO | null> {
    if (this.deleted.has(id)) return null;
    return this.carts.get(id) ?? null;
  }
  async updateStatus(id: string, status: CartStatus): Promise<void> {
    const c = this.carts.get(id);
    if (c) c.status = status;
  }
  async softDelete(id: string): Promise<void> {
    this.deleted.add(id);
  }
  async restore(id: string): Promise<void> {
    this.deleted.delete(id);
  }
  async listLineItems(cartId: string): Promise<CartLineItemDTO[]> {
    return this.items.filter((i) => i.cart_id === cartId && !this.deletedItems.has(i.id));
  }
  async findLineItem(lineId: string): Promise<CartLineItemDTO | null> {
    if (this.deletedItems.has(lineId)) return null;
    return this.items.find((i) => i.id === lineId) ?? null;
  }
  async insertLineItem(cartId: string, input: ResolvedLineItem): Promise<CartLineItemDTO> {
    const dto: CartLineItemDTO = {
      id: `cli_${++this.counter}`,
      cart_id: cartId,
      variant_id: input.variantId,
      product_id: input.productId,
      title: input.title,
      quantity: input.quantity,
      unit_price_minor: input.unitPriceMinor,
      currency_code: input.currencyCode,
      discount_minor: 0n,
    };
    this.items.push(dto);
    return dto;
  }
  async updateLineItemQuantity(lineId: string, quantity: number): Promise<void> {
    const item = this.items.find((i) => i.id === lineId);
    if (item) item.quantity = quantity;
  }
  async softDeleteLineItem(lineId: string): Promise<void> {
    this.deletedItems.add(lineId);
  }
  async upsertShippingMethod(
    cartId: string,
    input: ShippingMethodInput & { currencyCode: string },
  ): Promise<void> {
    this.shipping.set(cartId, {
      id: `csm_${++this.counter}`,
      cart_id: cartId,
      shipping_option_id: input.shippingOptionId,
      name: input.name,
      amount_minor: input.amountMinor,
      currency_code: input.currencyCode,
    });
  }
  async findShippingMethod(cartId: string): Promise<CartShippingMethodDTO | null> {
    return this.shipping.get(cartId) ?? null;
  }
  async linkCustomer(cartId: string, customerId: string): Promise<void> {
    this.customerLinks.set(cartId, customerId);
  }
}

/** 商品端口桩：变体 → 商品/标题。 */
class FakeProductLookup implements ProductLookupPort {
  constructor(
    private readonly status = "published",
    private readonly categoryIdsByProduct: Map<string, string[]> = new Map(),
  ) {}
  async listVariantsByIds(ids: string[]) {
    return ids.map((id) => ({
      id,
      product_id: "prod_1",
      sku: "SKU-1",
      title: "T 恤 黑色",
      status: this.status,
    }));
  }
  async listCategoryIdsByProducts(productIds: string[]) {
    return productIds
      .map((id) => ({ productId: id, categoryIds: this.categoryIdsByProduct.get(id) ?? [] }))
      .filter((e) => e.categoryIds.length > 0);
  }
}

/** 定价端口桩：唯一计价入口。 */
class FakePricingLookup implements PricingLookupPort {
  constructor(private readonly amountMinor: bigint | null = 9900n) {}
  async calculatePrices(input: { variantIds: string[] }) {
    if (this.amountMinor === null) return [];
    return input.variantIds.map((variantId) => ({
      variantId,
      amountMinor: this.amountMinor,
      currencyCode: "CNY",
    }));
  }
}

/** 运费端口桩：方案 id → 方案名与运费（后端解析，客户端只传 id）。 */
class FakeShippingLookup implements ShippingLookupPort {
  constructor(
    /** 规则价：模拟 free_over 时可按小计返回 0，否则返回方案基础价 800。 */
    private readonly freeOverThreshold: bigint | null = null,
  ) {}
  async findShippingOption(id: string) {
    if (id !== "shipopt_1") return null;
    return { id, name: "标准快递", amount_minor: 800n };
  }
  async calculateShippingPrice(optionId: string, ctx: { cartSubtotalMinor: bigint }) {
    if (optionId !== "shipopt_1") throw new Error("unknown option");
    // free_over 命中：小计 ≥ 门槛 → 0（免运费）；否则基础价 800
    if (this.freeOverThreshold !== null && ctx.cartSubtotalMinor >= this.freeOverThreshold) {
      return { amountMinor: 0n, currencyCode: "CNY" };
    }
    return { amountMinor: 800n, currencyCode: "CNY" };
  }
}

/** 促销端口桩：目录促销行级折扣（对每行返回固定折扣金额）+ 订单级折扣。 */
class FakePromotionLookup implements PromotionLookupPort {
  constructor(
    private readonly fixedDiscountMinor: bigint = 0n,
    private readonly orderDiscountMinor: bigint = 0n,
  ) {}
  async computeDiscounts(ctx: {
    currencyCode: string;
    customerId?: string | null;
    items: Array<{
      id: string;
      variantId: string;
      categoryIds: string[];
      quantity: number;
      unitPriceMinor: bigint;
    }>;
    subtotalMinor: bigint;
    shippingMinor: bigint;
    voucherCodes: string[];
    giftCardCodes: string[];
  }) {
    const lineAdjustments = ctx.items
      .map((i) => ({
        itemId: i.id,
        amountMinor: this.fixedDiscountMinor,
        promotionId: "promo_cat",
        code: "CAT",
      }))
      .filter((a) => a.amountMinor > 0n);
    const orderDiscounts =
      this.orderDiscountMinor > 0n
        ? [{ promotionId: "promo_ord", code: "ORDER20", amountMinor: this.orderDiscountMinor }]
        : [];
    return {
      lineAdjustments,
      orderDiscountMinor: this.orderDiscountMinor,
      orderDiscounts,
      voucherDiscountMinor: 0n,
      giftCardAppliedMinor: 0n,
    };
  }
}

function setup(
  opts: {
    productStatus?: string;
    price?: bigint | null;
    freeOverThreshold?: bigint | null;
    categoryIdsByProduct?: Map<string, string[]>;
    fixedDiscountMinor?: bigint;
    orderDiscountMinor?: bigint;
  } = {},
) {
  const repo = new InMemoryCartRepository();
  const service = new CartService({
    repo,
    product: new FakeProductLookup(opts.productStatus, opts.categoryIdsByProduct ?? new Map()),
    pricing: new FakePricingLookup(opts.price === undefined ? 9900n : opts.price),
    shipping: new FakeShippingLookup(opts.freeOverThreshold ?? null),
    promotion: new FakePromotionLookup(opts.fixedDiscountMinor ?? 0n, opts.orderDiscountMinor ?? 0n),
  });
  return { repo, service };
}

describe("CartService（M04，游客车 + 后端定价 + 软删/恢复）", () => {
  it("游客车：customer_id 为 null（cart_customer 无行）", async () => {
    const { repo, service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    expect(cart.customer_id).toBeNull();
    expect(repo.customerLinks.has(cart.id)).toBe(false);
    const detail = await service.retrieveCart(cart.id);
    expect(detail.items).toHaveLength(0);
  });

  it("注册用户车：cart_customer 建立关联", async () => {
    const { service } = setup();
    const cart = await service.createCart({
      channelId: "chn_cn",
      regionId: "reg_1",
      currencyCode: "CNY",
      customerId: "cust_1",
    });
    expect(cart.customer_id).toBe("cust_1");
  });

  it("行项目 CRUD + 金额快照", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    const added = await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });
    expect(added.items).toHaveLength(1);
    expect(added.items[0]?.unit_price_minor).toBe(9900n);

    const lineId = added.items[0]!.id;
    const updated = await service.updateLineItem(cart.id, lineId, { quantity: 3 });
    expect(updated.items[0]?.quantity).toBe(3);

    await service.deleteLineItem(cart.id, lineId);
    const afterDelete = await service.retrieveCart(cart.id);
    expect(afterDelete.items).toHaveLength(0);
  });

  it("加购只信后端：价格与标题由 product/pricing 端口解析（防客户端篡改）", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    // 客户端只传 variantId + quantity，无法指定价格
    const added = await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 });
    expect(added.items[0]?.unit_price_minor).toBe(9900n);
    expect(added.items[0]?.title).toBe("T 恤 黑色");
    expect(added.items[0]?.product_id).toBe("prod_1");
  });

  it("未发布变体不可加购", async () => {
    const { service } = setup({ productStatus: "draft" });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await expect(service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 })).rejects.toThrow();
  });

  it("无价变体不可加购（价格缺失即拒）", async () => {
    const { service } = setup({ price: null });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await expect(service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 })).rejects.toThrow();
  });

  it("setShippingMethod 走规则价（free_over 未命中=基础价）且 totals 读时计算", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    // 客户端只传方案 id，方案名与运费金额由后端解析
    const withShipping = await service.setShippingMethod(cart.id, {
      shippingOptionId: "shipopt_1",
    });
    expect(withShipping.shipping_method?.amount_minor).toBe(800n);
    expect(withShipping.shipping_method?.name).toBe("标准快递");
  });

  it("totals 在 retrieveCart 读时动态计算（小计=Σ单价×数量，合计=小计+运费）", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    // 加 2 件单价 9900 的商品
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 });
    await service.setShippingMethod(cart.id, { shippingOptionId: "shipopt_1" });

    const detail = await service.retrieveCart(cart.id);
    expect(detail.totals?.subtotal_minor).toBe(19800n);
    expect(detail.totals?.shipping_minor).toBe(800n);
    expect(detail.totals?.total_minor).toBe(20600n);
  });

  it("free_over 满额免运费命中：小计达标后运费为 0，且 totals 同步", async () => {
    const { service } = setup({ freeOverThreshold: 9900n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 }); // 小计 9900
    const withShipping = await service.setShippingMethod(cart.id, { shippingOptionId: "shipopt_1" });

    expect(withShipping.shipping_method?.amount_minor).toBe(0n); // 免运费
    expect(withShipping.totals?.shipping_minor).toBe(0n);
    expect(withShipping.totals?.total_minor).toBe(9900n);
  });

  it("目录促销折扣进 totals：discount_minor 累加 + 每行折扣回填", async () => {
    const { service } = setup({ fixedDiscountMinor: 1980n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 }); // 小计 19800
    await service.setShippingMethod(cart.id, { shippingOptionId: "shipopt_1" }); // 运费 800

    const detail = await service.retrieveCart(cart.id);
    expect(detail.totals?.subtotal_minor).toBe(19800n);
    expect(detail.totals?.shipping_minor).toBe(800n);
    expect(detail.totals?.discount_minor).toBe(1980n);
    expect(detail.totals?.total_minor).toBe(19800n + 800n - 1980n); // 18620
    expect(detail.items[0]?.discount_minor).toBe(1980n);
  });

  it("无促销命中时 discount_minor 为 0，合计不变", async () => {
    const { service } = setup(); // fixedDiscountMinor 默认 0
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 });
    await service.setShippingMethod(cart.id, { shippingOptionId: "shipopt_1" });

    const detail = await service.retrieveCart(cart.id);
    expect(detail.totals?.discount_minor).toBe(0n);
    expect(detail.totals?.total_minor).toBe(20600n);
    expect(detail.items[0]?.discount_minor).toBe(0n);
    expect(detail.discounts).toEqual([]);
  });

  it("订单促销折扣进 totals：discount_minor = 行级 + 订单级，且明细可留痕", async () => {
    const { service } = setup({ fixedDiscountMinor: 1980n, orderDiscountMinor: 2000n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 }); // 小计 19800
    await service.setShippingMethod(cart.id, { shippingOptionId: "shipopt_1" }); // 运费 800

    const detail = await service.retrieveCart(cart.id);
    // 行级 1980 + 订单级 2000 = 3980
    expect(detail.totals?.discount_minor).toBe(3980n);
    expect(detail.totals?.total_minor).toBe(19800n + 800n - 3980n); // 16620
    // 明细：目录促销（按促销聚合）+ 订单促销
    expect(detail.discounts).toEqual([
      { type: "catalogue", promotion_id: "promo_cat", code: "CAT", amount_minor: 1980n },
      { type: "order", promotion_id: "promo_ord", code: "ORDER20", amount_minor: 2000n },
    ]);
  });

  it("completeCart 软删 + completed；restoreCart 补偿回 open", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.completeCart(cart.id);
    await expect(service.retrieveCart(cart.id)).rejects.toThrow();

    await service.restoreCart(cart.id);
    const restored = await service.retrieveCart(cart.id);
    expect(restored.status).toBe("open");
  });

  it("非法数量被拒", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await expect(service.addLineItem(cart.id, { variantId: "var_1", quantity: 0 })).rejects.toThrow();
  });
});
