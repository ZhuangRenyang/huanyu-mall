import { describe, expect, it } from "vitest";
import { CartService } from "../src/services/cart.service.js";
import type {
  CartDTO,
  CartLineItemDTO,
  CartRepository,
  CartShippingMethodDTO,
  CartStatus,
  CartTotals,
  CreateCartInput,
  PricingLookupPort,
  ProductLookupPort,
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
  async updateTotals(id: string, totals: CartTotals): Promise<void> {
    const c = this.carts.get(id);
    if (c) c.totals = totals;
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
  constructor(private readonly status = "published") {}
  async listVariantsByIds(ids: string[]) {
    return ids.map((id) => ({
      id,
      product_id: "prod_1",
      sku: "SKU-1",
      title: "T 恤 黑色",
      status: this.status,
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
  async findShippingOption(id: string) {
    if (id !== "shipopt_1") return null;
    return { id, name: "标准快递", amount_minor: 800n };
  }
}

function setup(opts: { productStatus?: string; price?: bigint | null } = {}) {
  const repo = new InMemoryCartRepository();
  const service = new CartService({
    repo,
    product: new FakeProductLookup(opts.productStatus),
    pricing: new FakePricingLookup(opts.price === undefined ? 9900n : opts.price),
    shipping: new FakeShippingLookup(),
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

  it("setShippingMethod + applyTotals 快照", async () => {
    const { service } = setup();
    const cart = await service.createCart({ channelId: "chn_cn", regionId: "reg_1", currencyCode: "CNY" });
    // 客户端只传方案 id，方案名与运费金额由后端解析
    const withShipping = await service.setShippingMethod(cart.id, {
      shippingOptionId: "shipopt_1",
    });
    expect(withShipping.shipping_method?.amount_minor).toBe(800n);
    expect(withShipping.shipping_method?.name).toBe("标准快递");

    const applied = await service.applyTotals(cart.id, {
      subtotal_minor: 9900n,
      shipping_minor: 800n,
      tax_minor: 0n,
      total_minor: 10700n,
      discount_minor: 0n,
    });
    expect(applied.totals?.total_minor).toBe(10700n);
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
