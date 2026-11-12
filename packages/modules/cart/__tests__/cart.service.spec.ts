import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
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
  readonly voucherCodes = new Map<string, string[]>();
  readonly giftCardCodes = new Map<string, string[]>();
  private counter = 0;

  async updateShippingCountry(id: string, countryCode: string): Promise<void> {
    const cart = this.carts.get(id);
    if (!cart) return;
    cart.shipping_country = countryCode;
  }

  async insert(input: CreateCartInput & { id: string }): Promise<CartDTO> {
    const dto: CartDTO = {
      id: input.id,
      channel_id: input.channelId,
      region_id: input.regionId,
      currency_code: input.currencyCode,
      customer_id: input.customerId ?? null,
      email: input.email ?? null,
      status: "open",
      shipping_country: null,
      voucher_codes: [],
      gift_card_codes: [],
      totals: null,
    };
    this.carts.set(dto.id, dto);
    return dto;
  }
  async findById(id: string): Promise<CartDTO | null> {
    if (this.deleted.has(id)) return null;
    const cart = this.carts.get(id);
    if (!cart) return null;
    return {
      ...cart,
      voucher_codes: this.voucherCodes.get(id) ?? [],
      gift_card_codes: this.giftCardCodes.get(id) ?? [],
    };
  }
  async updateStatus(id: string, status: CartStatus): Promise<void> {
    const c = this.carts.get(id);
    if (c) c.status = status;
  }
  async updateVoucherCodes(id: string, codes: string[]): Promise<void> {
    this.voucherCodes.set(id, codes);
  }
  async updateGiftCardCodes(id: string, codes: string[]): Promise<void> {
    this.giftCardCodes.set(id, codes);
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
      // var_2 属于另一个商品：多模板运费测试需要「一车多商品」
      product_id: id === "var_2" ? "prod_2" : "prod_1",
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
  /** 默认不包邮、用默认模板；需要差异化时由用例往 map 里塞。 */
  readonly shippingInfo = new Map<string, { profileId: string | null; freeShipping: boolean }>();
  async listShippingInfoByProducts(productIds: string[]) {
    return productIds.map((id) => ({
      productId: id,
      profileId: this.shippingInfo.get(id)?.profileId ?? null,
      freeShipping: this.shippingInfo.get(id)?.freeShipping ?? false,
    }));
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
  /** 可用方案：CN 两个（含一个更便宜的），其它国家只有一个；ZZ 无可用方案。 */
  async listShippingOptions(input: {
    channelId: string;
    countryCode: string;
    profileId?: string | null;
  }) {
    if (input.countryCode === "ZZ") return [];
    // 重货模板：单独一套价（验证多模板分别计算后相加）
    if (input.profileId === "shprof_heavy") return [{ id: "shipopt_heavy", name: "重货专线" }];
    if (input.countryCode === "US") {
      return [
        { id: "shipopt_1", name: "标准快递" },
        { id: "shipopt_cheap", name: "经济快递" },
      ];
    }
    return [{ id: "shipopt_1", name: "标准快递" }];
  }
  async findShippingOption(id: string) {
    if (id !== "shipopt_1" && id !== "shipopt_cheap") return null;
    return { id, name: id === "shipopt_cheap" ? "经济快递" : "标准快递", amount_minor: 800n };
  }
  async calculateShippingPrice(optionId: string, ctx: { cartSubtotalMinor: bigint }) {
    if (optionId === "shipopt_heavy") return { amountMinor: 3000n, currencyCode: "CNY" };
    if (optionId === "shipopt_cheap") return { amountMinor: 500n, currencyCode: "CNY" };
    if (optionId !== "shipopt_1") throw new Error("unknown option");
    // free_over 命中：小计 ≥ 门槛 → 0（免运费）；否则基础价 800
    if (this.freeOverThreshold !== null && ctx.cartSubtotalMinor >= this.freeOverThreshold) {
      return { amountMinor: 0n, currencyCode: "CNY" };
    }
    return { amountMinor: 800n, currencyCode: "CNY" };
  }
}

/** 促销端口桩：目录促销行级折扣（对每行返回固定折扣金额）+ 订单级折扣 + voucher 折扣 + gift card 抵扣。 */
class FakePromotionLookup implements PromotionLookupPort {
  constructor(
    private readonly fixedDiscountMinor: bigint = 0n,
    private readonly orderDiscountMinor: bigint = 0n,
    private readonly voucherDiscountMinor: bigint = 0n,
    private readonly voucherCode: string = "V20",
    private readonly giftCardAppliedMinor: bigint = 0n,
    private readonly giftCardCode: string = "GC-100",
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
    // voucher 折扣只在顾客输入了券码时才命中（模拟 promotion 侧校验）。
    const voucherDiscounts =
      this.voucherDiscountMinor > 0n && ctx.voucherCodes.length > 0
        ? [{ promotionId: "vouch_1", code: this.voucherCode, amountMinor: this.voucherDiscountMinor }]
        : [];
    // gift card 抵扣只在顾客输入了卡码时才命中（模拟 promotion 侧校验）。
    const giftCardDiscounts =
      this.giftCardAppliedMinor > 0n && ctx.giftCardCodes.length > 0
        ? [{ giftCardId: "gcard_1", code: this.giftCardCode, amountMinor: this.giftCardAppliedMinor }]
        : [];
    return {
      lineAdjustments,
      orderDiscountMinor: this.orderDiscountMinor,
      orderDiscounts,
      voucherDiscountMinor: voucherDiscounts[0]?.amountMinor ?? 0n,
      voucherDiscounts,
      giftCardAppliedMinor: giftCardDiscounts[0]?.amountMinor ?? 0n,
      giftCardDiscounts,
    };
  }
}

/** 税务端口替身：按固定税率计税，够断言 totals 口径。 */
class FakeTaxLookup {
  constructor(
    private readonly rateBps: number,
    private readonly includedInPrice: boolean,
  ) {}
  async calculateTax(input: {
    countryCode?: string | null;
    lines: Array<{ lineId: string; amountMinor: bigint }>;
    shippingMinor: bigint;
  }) {
    const rate = BigInt(this.rateBps);
    const one = (amount: bigint) =>
      this.includedInPrice
        ? (amount * rate) / (10000n + rate)
        : (amount * rate) / 10000n;
    const lines = input.lines.map((l) => ({
      lineId: l.lineId,
      taxRateBps: this.rateBps,
      taxAmountMinor: one(l.amountMinor),
    }));
    const shippingTaxMinor = one(input.shippingMinor);
    const totalTaxMinor = lines.reduce((s, l) => s + l.taxAmountMinor, 0n) + shippingTaxMinor;
    return {
      lines,
      totalTaxMinor,
      shippingTaxMinor,
      rateSource: "default" as const,
      included_in_price: this.includedInPrice,
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
    voucherDiscountMinor?: bigint;
    giftCardAppliedMinor?: bigint;
    /** 税率（bps）；不传 = 0 税。 */
    taxRateBps?: number;
    /** 含税价口径；默认 true。 */
    pricesIncludeTax?: boolean;
  } = {},
) {
  const repo = new InMemoryCartRepository();
  const product = new FakeProductLookup(opts.productStatus, opts.categoryIdsByProduct ?? new Map());
  const service = new CartService({
    repo,
    product,
    pricing: new FakePricingLookup(opts.price === undefined ? 9900n : opts.price),
    shipping: new FakeShippingLookup(opts.freeOverThreshold ?? null),
    promotion: new FakePromotionLookup(
      opts.fixedDiscountMinor ?? 0n,
      opts.orderDiscountMinor ?? 0n,
      opts.voucherDiscountMinor ?? 0n,
      "V20",
      opts.giftCardAppliedMinor ?? 0n,
    ),
    tax: new FakeTaxLookup(opts.taxRateBps ?? 0, opts.pricesIncludeTax ?? true),
  });
  return { repo, service, product };
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
    // 先有商品才有运费可算（运费按商品所属模板分组，空车不出运费）
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });
    // 运费不再由客户端选：填国家后系统自动挑最便宜的可用方案（ADR-019）
    const withShipping = await service.setShippingCountry(cart.id, "CN");
    expect(withShipping.shipping_method?.amount_minor).toBe(800n);
    expect(withShipping.shipping_method?.name).toBe("标准快递");
  });

  it("totals 在 retrieveCart 读时动态计算（小计=Σ单价×数量，合计=小计+运费）", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    // 加 2 件单价 9900 的商品
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 });
    await service.setShippingCountry(cart.id, "CN");

    const detail = await service.retrieveCart(cart.id);
    expect(detail.totals?.subtotal_minor).toBe(19800n);
    expect(detail.totals?.shipping_minor).toBe(800n);
    expect(detail.totals?.total_minor).toBe(20600n);
  });

  it("free_over 满额免运费命中：小计达标后运费为 0，且 totals 同步", async () => {
    const { service } = setup({ freeOverThreshold: 9900n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 }); // 小计 9900
    const withShipping = await service.setShippingCountry(cart.id, "CN");

    expect(withShipping.shipping_method?.amount_minor).toBe(0n); // 免运费
    expect(withShipping.totals?.shipping_minor).toBe(0n);
    expect(withShipping.totals?.total_minor).toBe(9900n);
  });

  it("目录促销折扣进 totals：discount_minor 累加 + 每行折扣回填", async () => {
    const { service } = setup({ fixedDiscountMinor: 1980n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 }); // 小计 19800
    await service.setShippingCountry(cart.id, "CN"); // 运费 800

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
    await service.setShippingCountry(cart.id, "CN");

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
    await service.setShippingCountry(cart.id, "CN"); // 运费 800

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

  it("setVoucherCodes 持久化券码（去重）并传入 computeDiscounts", async () => {
    const { repo, service } = setup({ voucherDiscountMinor: 2000n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 }); // 小计 19800
    await service.setShippingCountry(cart.id, "CN"); // 运费 800

    const detail = await service.setVoucherCodes(cart.id, ["V20", "V20", ""]);
    expect(detail.voucher_codes).toEqual(["V20"]);
    // 刷新不丢：repo 持久化
    expect(repo.voucherCodes.get(cart.id)).toEqual(["V20"]);

    // voucher 折扣进 totals
    expect(detail.totals?.discount_minor).toBe(2000n);
    expect(detail.totals?.total_minor).toBe(19800n + 800n - 2000n);
    // 明细含 voucher 留痕
    expect(detail.discounts).toEqual([
      { type: "voucher", promotion_id: "vouch_1", code: "V20", amount_minor: 2000n },
    ]);
  });

  it("未输码时 voucher 折扣为 0，合计不变", async () => {
    const { service } = setup({ voucherDiscountMinor: 2000n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 });
    await service.setShippingCountry(cart.id, "CN");

    const detail = await service.retrieveCart(cart.id);
    expect(detail.totals?.discount_minor).toBe(0n);
    expect(detail.totals?.total_minor).toBe(20600n);
    expect(detail.discounts).toEqual([]);
  });

  it("setGiftCardCodes 持久化卡码（去重）并传入 computeDiscounts，抵扣进 totals", async () => {
    const { repo, service } = setup({ giftCardAppliedMinor: 10000n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 }); // 小计 19800
    await service.setShippingCountry(cart.id, "CN"); // 运费 800

    const detail = await service.setGiftCardCodes(cart.id, ["GC-100", "GC-100", ""]);
    expect(detail.gift_card_codes).toEqual(["GC-100"]);
    // 刷新不丢：repo 持久化
    expect(repo.giftCardCodes.get(cart.id)).toEqual(["GC-100"]);

    // gift card 抵扣进 totals
    expect(detail.totals?.discount_minor).toBe(10000n);
    expect(detail.totals?.total_minor).toBe(19800n + 800n - 10000n);
    // 明细含 gift_card 留痕
    expect(detail.discounts).toEqual([
      { type: "gift_card", promotion_id: "gcard_1", code: "GC-100", amount_minor: 10000n },
    ]);
  });

  it("未输卡码时 gift card 抵扣为 0，合计不变", async () => {
    const { service } = setup({ giftCardAppliedMinor: 10000n });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 });
    await service.setShippingCountry(cart.id, "CN");

    const detail = await service.retrieveCart(cart.id);
    expect(detail.totals?.discount_minor).toBe(0n);
    expect(detail.totals?.total_minor).toBe(20600n);
    expect(detail.discounts).toEqual([]);
  });
});

describe("totals 的税口径（ADR-018：含税价不重复加税）", () => {
  it("含税价：税已含在价格里，合计不再加", async () => {
    const { service } = setup({ price: 11300n, taxRateBps: 1300, pricesIncludeTax: true });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });

    const detail = await service.retrieveCart(cart.id, { countryCode: "CN" });
    // 11300 含 13% 税 → 税额 1300；合计仍等于小计（不能再加一次）
    expect(detail.totals!.tax_minor).toBe(1300n);
    expect(detail.totals!.total_minor).toBe(11300n);
    expect(detail.tax_included_in_price).toBe(true);
    expect(detail.items[0]!.tax_rate_bps).toBe(1300);
  });

  it("价外税：合计 = 小计 + 运费 + 税", async () => {
    const { service } = setup({
      price: 10000n,
      taxRateBps: 1300,
      pricesIncludeTax: false,
      freeOverThreshold: null,
    });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });

    const detail = await service.retrieveCart(cart.id, { countryCode: "CN" });
    expect(detail.totals!.tax_minor).toBe(1300n);
    // 运费 0 时运费税也是 0；合计仍是 11300
    expect(detail.totals!.shipping_tax_minor).toBe(0n);
    expect(detail.totals!.total_minor).toBe(11300n);
    expect(detail.tax_included_in_price).toBe(false);
  });

  it("不传国家也照样计税（用默认税率）", async () => {
    const { service } = setup({ price: 10000n, taxRateBps: 1000, pricesIncludeTax: false });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 2 });

    const detail = await service.retrieveCart(cart.id);
    expect(detail.totals!.tax_minor).toBe(2000n);
  });
});

describe("运费与税全自动（ADR-019：客户端不再参与金额）", () => {
  it("填国家后自动选最便宜的可用方案（US：800 vs 500 → 选 500）", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });

    const detail = await service.setShippingCountry(cart.id, "us");
    expect(detail.shipping_country).toBe("US"); // 归一为大写
    expect(detail.shipping_method?.shipping_option_id).toBe("shipopt_cheap");
    expect(detail.shipping_method?.amount_minor).toBe(500n);
    expect(detail.totals?.shipping_minor).toBe(500n);
  });

  it("没填国家：没有运费，合计不凭空加钱", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });

    const detail = await service.retrieveCart(cart.id);
    expect(detail.shipping_country).toBeNull();
    expect(detail.shipping_method).toBeNull();
    expect(detail.totals?.shipping_minor).toBe(0n);
  });

  it("该国没有可用方案：运费为空，不静默按 0 元发（下单会被 checkout 拦）", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });

    const detail = await service.setShippingCountry(cart.id, "ZZ");
    expect(detail.shipping_method).toBeNull();
  });

  it("换国家会按新国家重选运费（不是沿用旧方案）", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });

    expect((await service.setShippingCountry(cart.id, "CN")).shipping_method?.amount_minor).toBe(800n);
    expect((await service.setShippingCountry(cart.id, "US")).shipping_method?.amount_minor).toBe(500n);
  });

  it("旧接口不能跨区套用低价方案：CN 传经济快递（只在 US 有）→ 拒绝", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.setShippingCountry(cart.id, "CN");

    await expect(
      service.setShippingMethod(cart.id, { shippingOptionId: "shipopt_cheap" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("旧接口在没有收货国家时直接拒绝；非法国家码也拒绝", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });

    await expect(
      service.setShippingMethod(cart.id, { shippingOptionId: "shipopt_1" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(service.setShippingCountry(cart.id, "中国")).rejects.toBeInstanceOf(DomainError);
  });
});

/**
 * 运费跟着商品走（ADR-021，对齐淘宝「运费模板 + 卖家包邮」）。
 *
 * 守的是钱：包邮商品不能产生运费，也不能拿它的金额去凑满额门槛；
 * 不同模板的商品要分别计价后相加，不能只算一套。
 */
describe("运费按商品模板分组", () => {
  it("卖家包邮商品：运费 0，且显示「卖家包邮」", async () => {
    const { service, product } = setup();
    product.shippingInfo.set("prod_1", { profileId: null, freeShipping: true });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });

    const detail = await service.setShippingCountry(cart.id, "CN");
    expect(detail.shipping_method?.amount_minor).toBe(0n);
    expect(detail.shipping_method?.name).toBe("卖家包邮");
    expect(detail.totals?.shipping_minor).toBe(0n);
  });

  it("包邮商品不计入满额门槛：其余商品照常收运费", async () => {
    // 门槛 5000：包邮商品 9900 若被计入，就会误判为「已满额」
    const { service, product } = setup({ freeOverThreshold: 5000n });
    product.shippingInfo.set("prod_1", { profileId: null, freeShipping: true });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });

    const detail = await service.setShippingCountry(cart.id, "CN");
    expect(detail.shipping_method?.amount_minor).toBe(0n);
  });

  it("不同模板的商品：各自计价后相加（不是取其一）", async () => {
    const { service, product } = setup();
    // 商品 1 走默认模板（800），商品 2 走重货模板（3000）
    product.shippingInfo.set("prod_1", { profileId: null, freeShipping: false });
    product.shippingInfo.set("prod_2", { profileId: "shprof_heavy", freeShipping: false });
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    await service.addLineItem(cart.id, { variantId: "var_1", quantity: 1 });
    await service.addLineItem(cart.id, { variantId: "var_2", quantity: 1 });

    const detail = await service.setShippingCountry(cart.id, "CN");
    expect(detail.shipping_method?.amount_minor).toBe(3800n);
    expect(detail.totals?.shipping_minor).toBe(3800n);
  });
});
