import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { canTransition } from "../src/services/state-machine.js";
import { OrderService } from "../src/services/order.service.js";
import type {
  Actor,
  CreateOrderDiscountInput,
  CreateOrderInput,
  OrderDiscountDTO,
  OrderDiscountType,
  OrderDTO,
  OrderLineItemDTO,
  OrderQuery,
  OrderRepository,
  OrderShippingMethodDTO,
  OrderStatus,
  PaymentStatus,
} from "../src/types.js";

class InMemoryOrderRepository implements OrderRepository {
  readonly orders = new Map<string, OrderDTO>();
  readonly lineItems: OrderLineItemDTO[] = [];
  readonly snapshots = new Map<string, Record<string, unknown>>();
  readonly shipping = new Map<string, OrderShippingMethodDTO>();
  readonly history: Array<{ orderId: string; from: OrderStatus | null; to: OrderStatus; actor: Actor }> = [];
  readonly discounts: OrderDiscountDTO[] = [];
  private counter = 0;

  async insertOrder(input: {
    id: string;
    cartId?: string | null;
    customerId?: string | null;
    email: string;
    currencyCode: string;
    channelId: string;
    regionId: string;
    subtotalMinor: bigint;
    shippingMinor: bigint;
    taxMinor: bigint;
    discountMinor: bigint;
    totalMinor: bigint;
    shippingAddress: Record<string, unknown>;
    billingAddress?: Record<string, unknown> | null;
    paymentCollectionId?: string | null;
  }): Promise<OrderDTO> {
    const dto: OrderDTO = {
      id: input.id,
      status: "pending",
      cart_id: input.cartId ?? null,
      customer_id: input.customerId ?? null,
      email: input.email,
      currency_code: input.currencyCode,
      channel_id: input.channelId,
      region_id: input.regionId,
      subtotal_minor: input.subtotalMinor,
      shipping_minor: input.shippingMinor,
      tax_minor: input.taxMinor,
      discount_minor: input.discountMinor,
      total_minor: input.totalMinor,
      payment_status: "unpaid" as PaymentStatus,
      shipping_address: input.shippingAddress,
      payment_collection_id: input.paymentCollectionId ?? null,
      placed_at: new Date().toISOString(),
    };
    this.orders.set(dto.id, dto);
    return dto;
  }

  async insertLineItems(
    orderId: string,
    lines: Array<{
      variantId: string;
      productId: string;
      title: string;
      sku: string;
      quantity: number;
      unitPriceMinor: bigint;
      taxRateBps: number;
      taxAmountMinor: bigint;
      totalMinor: bigint;
      currencyCode: string;
      options?: Record<string, string> | null;
    }>,
  ): Promise<OrderLineItemDTO[]> {
    const created = lines.map((l) => ({
      id: `oli_${++this.counter}`,
      order_id: orderId,
      variant_id: l.variantId,
      product_id: l.productId,
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      unit_price_minor: l.unitPriceMinor,
      tax_rate_bps: l.taxRateBps,
      tax_amount_minor: l.taxAmountMinor,
      total_minor: l.totalMinor,
      currency_code: l.currencyCode,
      options: l.options ?? null,
    }));
    this.lineItems.push(...created);
    return created;
  }

  async insertSnapshots(items: Array<{ orderLineItemId: string; snapshot: Record<string, unknown> }>): Promise<void> {
    for (const i of items) this.snapshots.set(i.orderLineItemId, i.snapshot);
  }

  async insertShippingMethod(
    orderId: string,
    input: { name: string; carrierName?: string | null; amountMinor: bigint; currencyCode: string },
  ): Promise<void> {
    this.shipping.set(orderId, {
      id: `osm_${++this.counter}`,
      order_id: orderId,
      name: input.name,
      carrier_name: input.carrierName ?? null,
      amount_minor: input.amountMinor,
      currency_code: input.currencyCode,
    });
  }

  async insertDiscounts(orderId: string, discounts: CreateOrderDiscountInput[]): Promise<void> {
    for (const d of discounts) {
      this.discounts.push({
        id: `odisc_${++this.counter}`,
        order_id: orderId,
        promotion_id: d.promotionId,
        code: d.code ?? null,
        amount_minor: d.amountMinor,
        type: d.type as OrderDiscountType,
        created_at: new Date(),
      });
    }
  }
  async listDiscounts(orderId: string): Promise<OrderDiscountDTO[]> {
    return this.discounts.filter((d) => d.order_id === orderId);
  }

  async insertStatusHistory(
    orderId: string,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    actor: Actor,
  ): Promise<void> {
    this.history.push({ orderId, from: fromStatus, to: toStatus, actor });
  }

  async findById(id: string): Promise<OrderDTO | null> {
    return this.orders.get(id) ?? null;
  }
  async listLineItems(orderId: string): Promise<OrderLineItemDTO[]> {
    return this.lineItems.filter((l) => l.order_id === orderId);
  }
  async findShippingMethod(orderId: string): Promise<OrderShippingMethodDTO | null> {
    return this.shipping.get(orderId) ?? null;
  }
  async list(q: OrderQuery): Promise<{ items: OrderDTO[]; count: number }> {
    let items = [...this.orders.values()];
    if (q.status) items = items.filter((o) => o.status === q.status);
    return { items, count: items.length };
  }
  async updatePaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<void> {
    const o = this.orders.get(id);
    if (o) o.payment_status = paymentStatus;
  }
  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    const o = this.orders.get(id);
    if (o) o.status = status;
  }
}

function makeInput(overrides?: Partial<CreateOrderInput>): CreateOrderInput {
  return {
    cartId: "cart_1",
    customerId: "cust_1",
    email: "a@b.com",
    currencyCode: "CNY",
    channelId: "chn_cn",
    regionId: "reg_1",
    shippingAddress: { country: "CN", city: "深圳" },
    shippingMinor: 800n,
    items: [
      {
        variantId: "var_1",
        productId: "prod_1",
        title: "T 恤",
        sku: "TEE-BLK-S",
        quantity: 2,
        unitPriceMinor: 9900n,
        options: { color: "black" },
        snapshot: { title: "T 恤", sku: "TEE-BLK-S", options: { color: "black" } },
      },
    ],
    ...overrides,
  };
}

function setup() {
  const repo = new InMemoryOrderRepository();
  return { repo, service: new OrderService(repo) };
}

describe("OrderService（M05，状态机 + 行快照冻结 + 全额退款）", () => {
  it("createOrder 冻结行快照 + 计算总额", async () => {
    const { repo, service } = setup();
    const order = await service.createOrder(makeInput());
    expect(order.status).toBe("pending");
    expect(order.subtotal_minor).toBe(19800n);
    expect(order.total_minor).toBe(20600n); // 19800 + 800
    expect(order.items[0]?.title).toBe("T 恤");
    expect(order.items[0]?.unit_price_minor).toBe(9900n);
    // 快照已冻结入库
    expect(repo.snapshots.get(order.items[0]!.id)).toMatchObject({ sku: "TEE-BLK-S" });
  });

  it("状态机：合法迁移通过，非法迁移抛错", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput());
    expect(canTransition("pending", "awaiting_payment")).toBe(true);
    expect(canTransition("pending", "paid")).toBe(false);

    await expect(service.transition(order.id, "paid", { actor: "admin" })).rejects.toBeInstanceOf(DomainError);
    const next = await service.transition(order.id, "awaiting_payment", { actor: "workflow" });
    expect(next.status).toBe("awaiting_payment");
  });

  it("createOrder 固化 order_discount 留痕（discountMinor + discounts）", async () => {
    const { repo, service } = setup();
    const order = await service.createOrder(
      makeInput({
        discountMinor: 3980n,
        discounts: [
          { type: "catalogue", promotionId: "promo_cat", code: "CAT", amountMinor: 1980n },
          { type: "order", promotionId: "promo_ord", code: "ORDER20", amountMinor: 2000n },
        ],
      }),
    );
    // 总额 = 19800 + 800 - 3980 = 16620
    expect(order.total_minor).toBe(16620n);
    expect(order.discount_minor).toBe(3980n);

    // 留痕表可查：哪笔订单、哪个促销、多少钱
    const detail = await service.retrieveOrder(order.id);
    expect(detail.discounts).toEqual([
      expect.objectContaining({ promotion_id: "promo_cat", code: "CAT", amount_minor: 1980n, type: "catalogue" }),
      expect.objectContaining({ promotion_id: "promo_ord", code: "ORDER20", amount_minor: 2000n, type: "order" }),
    ]);
    expect(repo.discounts).toHaveLength(2);
    expect(repo.discounts[0]?.id.startsWith("odisc_")).toBe(true);
  });

  it("全生命周期：pending→awaiting_payment→paid→fulfilled→delivered→completed", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput());
    for (const to of ["awaiting_payment", "paid", "fulfilled", "delivered", "completed"] as OrderStatus[]) {
      await service.transition(order.id, to, { actor: "workflow" });
    }
    const final = await service.retrieveOrder(order.id);
    expect(final.status).toBe("completed");
  });

  it("全额退款：createRefundRequest 全额通过 + markRefundSettled → refunded", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput());
    await service.transition(order.id, "awaiting_payment", { actor: "workflow" });
    await service.transition(order.id, "paid", { actor: "workflow" });

    const req = await service.createRefundRequest(order.id, { amountMinor: 20600n, reason: "客户申请" });
    expect(req.amountMinor).toBe(20600n);

    const settled = await service.markRefundSettled(order.id, "ref_1");
    expect(settled.status).toBe("refunded");
  });

  it("部分退款被拒（K4 只全额）", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput());
    await service.transition(order.id, "awaiting_payment", { actor: "workflow" });
    await service.transition(order.id, "paid", { actor: "workflow" });
    await expect(
      service.createRefundRequest(order.id, { amountMinor: 10000n, reason: "部分" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("行快照冻结后 retrieveOrder 只回读快照，不回查目录", async () => {
    const { repo, service } = setup();
    const order = await service.createOrder(makeInput());
    // 模拟"目录变更"：order 模块不持有 catalog，retrieve 只读自身存储
    const detail = await service.retrieveOrder(order.id);
    expect(detail.items[0]?.sku).toBe("TEE-BLK-S");
    expect(detail.items[0]?.unit_price_minor).toBe(9900n);
    expect(repo.snapshots.size).toBe(1);
  });

  it("cancelOrder 幂等（重复调用不报错）", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput());
    await service.cancelOrder(order.id);
    await service.cancelOrder(order.id);
    const detail = await service.retrieveOrder(order.id);
    expect(detail.status).toBe("canceled");
  });
});
