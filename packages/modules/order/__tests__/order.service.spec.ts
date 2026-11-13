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
  RefundRequestDTO,
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
  readonly refundRequests: RefundRequestDTO[] = [];
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
    /** 顾客留言（ADR-050）：服务层已归一化，仓储只负责落库。 */
    customerNote?: string | null;
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
      merchant_note: null,
      customer_note: input.customerNote ?? null,
    };
    this.orders.set(dto.id, dto);
    return dto;
  }

  /** 商家备注：只有这一个字段被改，顾客留言保持原样（ADR-050 的可见范围是两回事）。 */
  async setMerchantNote(id: string, note: string | null): Promise<OrderDTO | null> {
    const found = this.orders.get(id);
    if (!found) return null;
    const next = { ...found, merchant_note: note };
    this.orders.set(id, next);
    return next;
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

  // ---- 退款申请单 ----

  async insertRefundRequest(input: {
    id: string;
    orderId: string;
    customerId: string | null;
    amountMinor: bigint;
    currencyCode: string;
    reason: string;
    source: RefundRequestDTO["source"];
    orderStatusBefore: RefundRequestDTO["order_status_before"];
    resolution: RefundRequestDTO["resolution"];
  }): Promise<RefundRequestDTO> {
    const dto: RefundRequestDTO = {
      id: input.id,
      order_id: input.orderId,
      customer_id: input.customerId,
      amount_minor: input.amountMinor,
      currency_code: input.currencyCode,
      reason: input.reason,
      source: input.source,
      status: "pending",
      resolution: input.resolution,
      return_carrier: null,
      return_tracking_number: null,
      return_shipped_at: null,
      return_received_at: null,
      review_note: null,
      reviewed_at: null,
      refund_id: null,
      order_status_before: input.orderStatusBefore,
      created_at: new Date().toISOString(),
    };
    this.refundRequests.push(dto);
    return dto;
  }

  async findRefundRequest(id: string): Promise<RefundRequestDTO | null> {
    return this.refundRequests.find((r) => r.id === id) ?? null;
  }

  async findActiveRefundRequest(orderId: string): Promise<RefundRequestDTO | null> {
    const ACTIVE: RefundRequestDTO["status"][] = ["pending", "awaiting_return", "returned"];
    return (
      this.refundRequests.find((r) => r.order_id === orderId && ACTIVE.includes(r.status)) ?? null
    );
  }

  async listRefundRequests(q: {
    status?: RefundRequestDTO["status"];
    limit?: number;
    offset?: number;
  }): Promise<{ items: RefundRequestDTO[]; count: number }> {
    const all = q.status
      ? this.refundRequests.filter((r) => r.status === q.status)
      : this.refundRequests;
    const offset = q.offset ?? 0;
    return { items: all.slice(offset, offset + (q.limit ?? all.length)), count: all.length };
  }

  async updateRefundRequest(
    id: string,
    patch: {
      status: RefundRequestDTO["status"];
      reviewNote?: string | null;
      refundId?: string | null;
      returnReceivedAt?: Date | null;
    },
  ): Promise<RefundRequestDTO | null> {
    const req = this.refundRequests.find((r) => r.id === id);
    if (!req) return null;
    req.status = patch.status;
    if (patch.reviewNote !== undefined) req.review_note = patch.reviewNote;
    if (patch.refundId !== undefined) req.refund_id = patch.refundId;
    if (patch.returnReceivedAt !== undefined) {
      req.return_received_at = patch.returnReceivedAt
        ? patch.returnReceivedAt.toISOString()
        : null;
    }
    req.reviewed_at = new Date().toISOString();
    return req;
  }

  async setReturnShipment(
    id: string,
    input: { carrier: string; trackingNumber: string; shippedAt: Date },
  ): Promise<RefundRequestDTO | null> {
    const req = this.refundRequests.find((r) => r.id === id);
    if (!req) return null;
    req.status = "returned";
    req.return_carrier = input.carrier;
    req.return_tracking_number = input.trackingNumber;
    req.return_shipped_at = input.shippedAt.toISOString();
    return req;
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

  it("运费税额计入订单税（价外税时也计入合计）——少收一份就是少收钱", async () => {
    const { service } = setup();
    const order = await service.createOrder(
      makeInput({
        shippingTaxMinor: 104n,
        pricesIncludeTax: false,
        items: [
          {
            variantId: "var_1",
            productId: "prod_1",
            title: "T 恤",
            sku: "TEE-BLK-S",
            quantity: 2,
            unitPriceMinor: 9900n,
            taxRateBps: 1300,
            taxAmountMinor: 2574n,
            snapshot: { title: "T 恤" },
          },
        ],
      }),
    );
    // 税 = 行税 2574 + 运费税 104
    expect(order.tax_minor).toBe(2678n);
    // 合计 = 19800 + 800 + 2678（价外税）
    expect(order.total_minor).toBe(23278n);
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

    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "客户申请",
      source: "customer",
    });
    expect(req.amount_minor).toBe(20600n);
    expect(req.status).toBe("pending");

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

/**
 * 退款审核（对齐淘宝：申请后订单「退款中」，商家审核通过才打款）。
 *
 * 这一组守的是**审核是不是真的生效**，而不是「单据状态字段有没有变」：
 * 申请后订单必须立刻冻结（不能再发货、不能取消），拒绝要精确回到申请前的状态，
 * 否则会出现「货发了、钱也退了」或者「拒绝退款后订单变回待发货」这种账实不符。
 */
describe("退款审核：申请即冻结", () => {
  async function paidOrder(status: "paid" | "fulfilled" = "paid") {
    const { repo, service } = setup();
    const order = await service.createOrder(makeInput());
    await service.transition(order.id, "awaiting_payment", { actor: "workflow" });
    await service.transition(order.id, "paid", { actor: "workflow" });
    if (status === "fulfilled") {
      await service.transition(order.id, "fulfilled", { actor: "admin" });
    }
    return { repo, service, order };
  }

  it("买家申请退款后，订单立刻转「退款中」并记下原状态", async () => {
    const { service, order } = await paidOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "不想要了",
      source: "customer",
    });
    expect(req.status).toBe("pending");
    expect(req.order_status_before).toBe("paid");

    const after = await service.retrieveOrder(order.id);
    expect(after.status).toBe("refund_pending");
  });

  it("退款审核中不能再申请一次（避免两张单同时退）", async () => {
    const { service, order } = await paidOrder();
    await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "不想要了",
      source: "customer",
    });
    await expect(
      service.createRefundRequest(order.id, {
        amountMinor: 20600n,
        reason: "再申请一次",
        source: "customer",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("退款审核中不能取消订单（两条路会打架）", async () => {
    const { service, order } = await paidOrder();
    await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "不想要了",
      source: "customer",
    });
    await expect(service.cancelOrder(order.id)).rejects.toBeInstanceOf(DomainError);
  });

  it("拒绝退款：订单回到申请前的状态（已发货的仍回已发货）", async () => {
    const { service, order } = await paidOrder("fulfilled");
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "不想要了",
      source: "customer",
    });
    expect((await service.retrieveOrder(order.id)).status).toBe("refund_pending");

    await service.rejectRefundRequest(req.id, "商品已发出，请收到后再申请");
    const after = await service.retrieveOrder(order.id);
    // 不能一律回 paid：这单已经发过货了
    expect(after.status).toBe("fulfilled");
  });

  it("撤销退款：订单同样恢复原状态", async () => {
    const { service, order } = await paidOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "拍错了",
      source: "customer",
    });
    await service.cancelRefundRequest(req.id);
    expect((await service.retrieveOrder(order.id)).status).toBe("paid");
  });

  it("同意退款：订单转已退款（由 workflow 的 markRefundSettled 推进）", async () => {
    const { service, order } = await paidOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "不想要了",
      source: "customer",
    });
    await service.markRefundSettled(order.id, req.id);
    expect((await service.retrieveOrder(order.id)).status).toBe("refunded");
  });
});

describe("退货退款：货没回来不打款（ADR-051）", () => {
  /** 造一笔「已发货」订单 —— 只有发出去的货才谈得上退货。 */
  async function shippedOrder() {
    const { repo, service } = setup();
    const order = await service.createOrder(makeInput());
    await service.transition(order.id, "awaiting_payment", { actor: "workflow" });
    await service.transition(order.id, "paid", { actor: "workflow" });
    await service.transition(order.id, "fulfilled", { actor: "admin" });
    return { repo, service, order };
  }

  it("未发货的订单不能申请退货退款（买家没货可寄，单据会永久卡住）", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput());
    await service.transition(order.id, "awaiting_payment", { actor: "workflow" });
    await service.transition(order.id, "paid", { actor: "workflow" });
    await expect(
      service.createRefundRequest(order.id, {
        amountMinor: 20600n,
        reason: "不想要了",
        source: "customer",
        resolution: "return_refund",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("已发货的订单可以申请退货退款，缺省仍是仅退款（老客户端不受影响）", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "尺码不对",
      source: "customer",
      resolution: "return_refund",
    });
    expect(req.resolution).toBe("return_refund");
    expect(req.status).toBe("pending");

    // 缺省：不传 resolution 就是仅退款
    const { service: s2, order: o2 } = await shippedOrder();
    const req2 = await s2.createRefundRequest(o2.id, {
      amountMinor: 20600n,
      reason: "不想要了",
      source: "customer",
    });
    expect(req2.resolution).toBe("refund_only");
  });

  it("同意退货只改单据、**不打款**：状态进 awaiting_return，没有资金流水", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "尺码不对",
      source: "customer",
      resolution: "return_refund",
    });
    const agreed = await service.agreeReturnRequest(req.id, "请寄回原包装");
    expect(agreed.status).toBe("awaiting_return");
    expect(agreed.refund_id).toBeNull();
    // 订单仍在退款中：还能发货就白送了
    expect((await service.retrieveOrder(order.id)).status).toBe("refund_pending");
  });

  it("退货退款不能走「同意即退款」那条直路（服务端守，不靠按钮别点错）", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "尺码不对",
      source: "customer",
      resolution: "return_refund",
    });
    await expect(service.approveRefundRequest(req.id, "rfd_x")).rejects.toBeInstanceOf(DomainError);
  });

  it("仅退款不能走「同意退货」那条路（两条路各自守）", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "不想要了",
      source: "customer",
    });
    await expect(service.agreeReturnRequest(req.id)).rejects.toBeInstanceOf(DomainError);
  });

  it("买家填退货单号：进 returned；物流公司或单号为空则拒绝", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "尺码不对",
      source: "customer",
      resolution: "return_refund",
    });
    // 必须先「同意退货」，否则单据还在待处理（status 守卫先拦）
    await service.agreeReturnRequest(req.id);
    await expect(
      service.shipReturn(req.id, { carrier: "  ", trackingNumber: "SF123" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      service.shipReturn(req.id, { carrier: "顺丰", trackingNumber: "" }),
    ).rejects.toBeInstanceOf(DomainError);

    const shipped = await service.shipReturn(req.id, { carrier: "顺丰", trackingNumber: " SF123456 " });
    expect(shipped.status).toBe("returned");
    expect(shipped.return_carrier).toBe("顺丰");
    expect(shipped.return_tracking_number).toBe("SF123456");
    expect(shipped.return_shipped_at).not.toBeNull();
  });

  it("确认收货才打款：returned → approved，并记下收货时间", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "尺码不对",
      source: "customer",
      resolution: "return_refund",
    });
    await service.agreeReturnRequest(req.id);
    await service.shipReturn(req.id, { carrier: "顺丰", trackingNumber: "SF123456" });

    const settled = await service.confirmReturnReceived(req.id, "rfd_ok", "已收到，包装完好");
    expect(settled.status).toBe("approved");
    expect(settled.refund_id).toBe("rfd_ok");
    expect(settled.return_received_at).not.toBeNull();
  });

  it("还没寄回就确认收货：拒绝（防止商家手快把钱退了）", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "尺码不对",
      source: "customer",
      resolution: "return_refund",
    });
    await service.agreeReturnRequest(req.id);
    await expect(service.confirmReturnReceived(req.id, "rfd_x")).rejects.toBeInstanceOf(DomainError);
  });

  it("等寄回期间不能再提一张（否则商家会退两次）", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "尺码不对",
      source: "customer",
      resolution: "return_refund",
    });
    await service.agreeReturnRequest(req.id);
    await expect(
      service.createRefundRequest(order.id, {
        amountMinor: 20600n,
        reason: "再申请一次",
        source: "customer",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("买家可以在寄回前撤销，订单恢复原状态", async () => {
    const { service, order } = await shippedOrder();
    const req = await service.createRefundRequest(order.id, {
      amountMinor: 20600n,
      reason: "尺码不对",
      source: "customer",
      resolution: "return_refund",
    });
    await service.agreeReturnRequest(req.id);
    const canceled = await service.cancelRefundRequest(req.id);
    expect(canceled.status).toBe("canceled");
    expect((await service.retrieveOrder(order.id)).status).toBe("fulfilled");
  });
});

describe("状态机：顾客确认收货（ADR-049）", () => {
  it("fulfilled 可直接 completed（delivered 不是必经步骤）", () => {
    expect(canTransition("fulfilled", "completed")).toBe(true);
    // 其余方向仍不允许：不能从 paid 一步完成、也不能回退
    expect(canTransition("paid", "completed")).toBe(false);
    expect(canTransition("completed", "fulfilled")).toBe(false);
  });
});

describe("顾客留言：给卖家留言（ADR-050）", () => {
  it("空白留言存 null，不存空串（前端只需判一种空）", async () => {
    const { service } = setup();
    for (const blank of ["", "   ", "\n\t", null, undefined]) {
      const order = await service.createOrder(makeInput({ customerNote: blank }));
      expect(order.customer_note).toBeNull();
    }
  });

  it("超长留言截断到 200 字而不是报错（顾客已点过下单，不值得为备注挡回去）", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput({ customerNote: "易".repeat(500) }));
    expect(order.customer_note).toHaveLength(200);
    expect(order.customer_note).toBe("易".repeat(200));
  });

  it("正常留言原样落库并去掉首尾空白", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput({ customerNote: "  请发顺丰，工作日白天送  " }));
    expect(order.customer_note).toBe("请发顺丰，工作日白天送");
  });

  it("与商家备注互不覆盖：一个进门店契约，一个只在后台", async () => {
    const { service } = setup();
    const order = await service.createOrder(makeInput({ customerNote: "送货前打电话" }));
    await service.setMerchantNote(order.id, "老客户，可送赠品");
    const after = await service.retrieveOrder(order.id);
    expect(after.customer_note).toBe("送货前打电话");
    expect(after.merchant_note).toBe("老客户，可送赠品");
  });
});
