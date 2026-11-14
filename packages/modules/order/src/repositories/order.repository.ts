import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";

/** 已成交的订单状态（ADR-067）：销量只数这些，未付款/取消/退款都不算。 */
const SOLD_STATUSES = [
  "paid",
  "partially_fulfilled",
  "fulfilled",
  "delivered",
  "completed",
] as const;
import type {
  ActiveRefundDTO,
  Actor,
  CreateOrderDiscountInput,
  CustomerOrderSummaryDTO,
  OrderDiscountDTO,
  OrderDiscountType,
  OrderDTO,
  OrderLineItemDTO,
  OrderQuery,
  OrderRepository,
  OrderShippingMethodDTO,
  OrderStatus,
  PaymentStatus,
  RefundResolution,
  RefundRequestDTO,
  RefundRequestQuery,
  RefundRequestSource,
  RefundRequestStatus,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleOrderRepository implements OrderRepository {
  constructor(private readonly db: Db) {}

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
    /** 顾客留言（ADR-050）：服务层已归一化，这里只落库。 */
    customerNote?: string | null;
  }): Promise<OrderDTO> {
    const rows = await this.db
      .insert(schema.order)
      .values({
        id: input.id,
        status: "pending",
        cartId: input.cartId ?? null,
        customerId: input.customerId ?? null,
        email: input.email,
        currencyCode: input.currencyCode,
        channelId: input.channelId,
        regionId: input.regionId,
        subtotalMinor: input.subtotalMinor,
        shippingMinor: input.shippingMinor,
        taxMinor: input.taxMinor,
        discountMinor: input.discountMinor,
        totalMinor: input.totalMinor,
        shippingAddress: input.shippingAddress,
        billingAddress: input.billingAddress ?? null,
        paymentCollectionId: input.paymentCollectionId ?? null,
        customerNote: input.customerNote ?? null,
        placedAt: new Date(),
      })
      .returning();
    return toOrderDTO(rows[0]!);
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
    if (lines.length === 0) return [];
    const rows = await this.db
      .insert(schema.orderLineItem)
      .values(
        lines.map((l) => ({
          id: prefixedUlid("oli"),
          orderId,
          variantId: l.variantId,
          productId: l.productId,
          title: l.title,
          sku: l.sku,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          taxRateBps: l.taxRateBps,
          taxAmountMinor: l.taxAmountMinor,
          totalMinor: l.totalMinor,
          currencyCode: l.currencyCode,
          options: l.options ?? null,
        })),
      )
      .returning();
    return rows.map(toLineItemDTO);
  }

  async insertSnapshots(
    items: Array<{ orderLineItemId: string; snapshot: Record<string, unknown> }>,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.db.insert(schema.orderItemSnapshot).values(
      items.map((i) => ({ id: prefixedUlid("ois"), orderLineItemId: i.orderLineItemId, snapshot: i.snapshot })),
    );
  }

  async insertShippingMethod(
    orderId: string,
    input: { name: string; carrierName?: string | null; amountMinor: bigint; currencyCode: string },
  ): Promise<void> {
    await this.db.insert(schema.orderShippingMethod).values({
      id: prefixedUlid("osm"),
      orderId,
      name: input.name,
      carrierName: input.carrierName ?? null,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
    });
  }

  async insertDiscounts(
    orderId: string,
    discounts: Array<{ type: OrderDiscountType; promotionId: string; code: string | null; amountMinor: bigint }>,
  ): Promise<void> {
    if (discounts.length === 0) return;
    await this.db.insert(schema.orderDiscount).values(
      discounts.map((d) => ({
        id: prefixedUlid("odisc"),
        orderId,
        promotionId: d.promotionId,
        code: d.code ?? null,
        amountMinor: d.amountMinor,
        type: d.type,
      })),
    );
  }

  async listDiscounts(orderId: string): Promise<OrderDiscountDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.orderDiscount)
      .where(eq(schema.orderDiscount.orderId, orderId));
    return rows.map(toOrderDiscountDTO);
  }

  async insertStatusHistory(
    orderId: string,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    actor: Actor,
    reason?: string | null,
  ): Promise<void> {
    await this.db.insert(schema.orderStatusHistory).values({
      id: prefixedUlid("osh"),
      orderId,
      fromStatus,
      toStatus,
      actor,
      reason: reason ?? null,
    });
  }

  // ---- 退款申请单 ----

  async insertRefundRequest(input: {
    id: string;
    orderId: string;
    customerId: string | null;
    amountMinor: bigint;
    currencyCode: string;
    reason: string;
    source: RefundRequestSource;
    orderStatusBefore: OrderStatus;
    resolution: RefundResolution;
    exchangeVariantId?: string | null;
    exchangeQuantity?: number;
    exchangeLabel?: string | null;
  }): Promise<RefundRequestDTO> {
    const rows = await this.db
      .insert(schema.refundRequest)
      .values({
        id: input.id,
        orderId: input.orderId,
        customerId: input.customerId,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
        reason: input.reason,
        source: input.source,
        orderStatusBefore: input.orderStatusBefore,
        resolution: input.resolution,
        exchangeVariantId: input.exchangeVariantId ?? null,
        exchangeQuantity: input.exchangeQuantity ?? 1,
        exchangeLabel: input.exchangeLabel ?? null,
      })
      .returning();
    return toRefundRequestDTO(rows[0]!);
  }

  async findRefundRequest(id: string): Promise<RefundRequestDTO | null> {
    const rows = await this.db
      .select({
        req: schema.refundRequest,
        email: schema.order.email,
      })
      .from(schema.refundRequest)
      .leftJoin(schema.order, eq(schema.order.id, schema.refundRequest.orderId))
      .where(eq(schema.refundRequest.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toRefundRequestDTO(row.req, row.email) : null;
  }

  async findActiveRefundRequest(orderId: string): Promise<RefundRequestDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.refundRequest)
      .where(
        and(
          eq(schema.refundRequest.orderId, orderId),
          // 在途 = 还没走完的三种：待处理 / 待买家寄回 / 待商家收货
          inArray(schema.refundRequest.status, ["pending", "awaiting_return", "returned"]),
        ),
      )
      .limit(1);
    return rows[0] ? toRefundRequestDTO(rows[0]) : null;
  }

  async listRefundRequests(q: RefundRequestQuery): Promise<{ items: RefundRequestDTO[]; count: number }> {
    const conds = [
      ...(q.status ? [eq(schema.refundRequest.status, q.status)] : []),
      ...(q.orderId ? [eq(schema.refundRequest.orderId, q.orderId)] : []),
    ];
    const where = conds.length > 0 ? and(...conds) : undefined;
    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;
    const rows = await this.db
      .select({ req: schema.refundRequest, email: schema.order.email })
      .from(schema.refundRequest)
      .leftJoin(schema.order, eq(schema.order.id, schema.refundRequest.orderId))
      .where(where)
      .orderBy(desc(schema.refundRequest.createdAt))
      .limit(limit)
      .offset(offset);
    const totalRows = await this.db
      .select({ id: schema.refundRequest.id })
      .from(schema.refundRequest)
      .where(where);
    return {
      items: rows.map((r) => toRefundRequestDTO(r.req, r.email)),
      count: totalRows.length,
    };
  }

  async listActiveRefundsByOrderIds(
    orderIds: string[],
  ): Promise<Record<string, ActiveRefundDTO>> {
    if (orderIds.length === 0) return {};
    const rows = await this.db
      .select({
        orderId: schema.refundRequest.orderId,
        id: schema.refundRequest.id,
        status: schema.refundRequest.status,
        resolution: schema.refundRequest.resolution,
        createdAt: schema.refundRequest.createdAt,
      })
      .from(schema.refundRequest)
      .where(
        and(
          inArray(schema.refundRequest.orderId, orderIds),
          // 已处理完（approved / rejected / canceled）的不再挂角标
          inArray(schema.refundRequest.status, ["pending", "awaiting_return", "returned"]),
        ),
      )
      // 同一单可能有多张历史单据，取最新一张：列表只显示当前进度
      .orderBy(desc(schema.refundRequest.createdAt));
    const out: Record<string, ActiveRefundDTO> = {};
    for (const r of rows) {
      if (out[r.orderId]) continue;
      out[r.orderId] = {
        id: r.id,
        status: r.status as "pending" | "awaiting_return" | "returned",
        resolution: r.resolution as ActiveRefundDTO["resolution"],
      };
    }
    return out;
  }

  async countRefundRequestsByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: schema.refundRequest.status, n: sql<number>`count(*)::int` })
      .from(schema.refundRequest)
      .groupBy(schema.refundRequest.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }

  async updateRefundRequest(
    id: string,
    patch: {
      status: RefundRequestStatus;
      reviewNote?: string | null;
      refundId?: string | null;
      returnReceivedAt?: Date | null;
      returnAddress?: string | null;
    },
  ): Promise<RefundRequestDTO | null> {
    const rows = await this.db
      .update(schema.refundRequest)
      .set({
        status: patch.status,
        ...(patch.reviewNote !== undefined ? { reviewNote: patch.reviewNote } : {}),
        ...(patch.refundId !== undefined ? { refundId: patch.refundId } : {}),
        ...(patch.returnReceivedAt !== undefined ? { returnReceivedAt: patch.returnReceivedAt } : {}),
        ...(patch.returnAddress !== undefined ? { returnAddress: patch.returnAddress } : {}),
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.refundRequest.id, id))
      .returning();
    return rows[0] ? toRefundRequestDTO(rows[0]) : null;
  }

  async setReturnShipment(
    id: string,
    input: { carrier: string; trackingNumber: string; shippedAt: Date },
  ): Promise<RefundRequestDTO | null> {
    const rows = await this.db
      .update(schema.refundRequest)
      .set({
        status: "returned",
        returnCarrier: input.carrier,
        returnTrackingNumber: input.trackingNumber,
        returnShippedAt: input.shippedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.refundRequest.id, id))
      .returning();
    return rows[0] ? toRefundRequestDTO(rows[0]) : null;
  }

  async setExchangeShipment(
    id: string,
    input: { carrier: string; trackingNumber: string; shippedAt: Date },
  ): Promise<RefundRequestDTO | null> {
    const rows = await this.db
      .update(schema.refundRequest)
      .set({
        status: "completed",
        exchangeCarrier: input.carrier,
        exchangeTrackingNumber: input.trackingNumber,
        exchangeShippedAt: input.shippedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.refundRequest.id, id))
      .returning();
    return rows[0] ? toRefundRequestDTO(rows[0]) : null;
  }

  async setMerchantNote(id: string, note: string | null): Promise<OrderDTO | null> {
    const rows = await this.db
      .update(schema.order)
      .set({ merchantNote: note, updatedAt: new Date() })
      .where(eq(schema.order.id, id))
      .returning();
    return rows[0] ? toOrderDTO(rows[0]) : null;
  }

  async findById(id: string): Promise<OrderDTO | null> {
    const rows = await this.db.select().from(schema.order).where(eq(schema.order.id, id)).limit(1);
    return rows[0] ? toOrderDTO(rows[0]) : null;
  }

  async listLineItems(orderId: string): Promise<OrderLineItemDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.orderLineItem)
      .where(eq(schema.orderLineItem.orderId, orderId));
    return rows.map(toLineItemDTO);
  }

  async listLineItemsByOrderIds(orderIds: string[]): Promise<OrderLineItemDTO[]> {
    if (orderIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.orderLineItem)
      .where(inArray(schema.orderLineItem.orderId, orderIds));
    return rows.map(toLineItemDTO);
  }

  async summarizeByCustomerIds(customerIds: string[]): Promise<CustomerOrderSummaryDTO[]> {
    const ids = [...new Set(customerIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        customerId: schema.order.customerId,
        orderCount: sql<number>`count(*)::int`,
        totalSpent: sql<string>`coalesce(sum(${schema.order.totalMinor}), 0)::text`,
        lastOrderAt: sql<string | null>`max(${schema.order.createdAt})`,
      })
      .from(schema.order)
      .where(
        and(
          inArray(schema.order.customerId, ids),
          // 只算已付款且未退款：否则「消费额」会把取消和退款的钱也算进去
          inArray(schema.order.status, [
            "paid",
            "partially_fulfilled",
            "fulfilled",
            "delivered",
            "completed",
          ]),
        ),
      )
      .groupBy(schema.order.customerId);
    return rows.map((r) => ({
      customer_id: String(r.customerId),
      order_count: Number(r.orderCount),
      total_spent_minor: BigInt(r.totalSpent ?? "0"),
      last_order_at: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : null,
    }));
  }

  async findShippingMethod(orderId: string): Promise<OrderShippingMethodDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.orderShippingMethod)
      .where(eq(schema.orderShippingMethod.orderId, orderId))
      .limit(1);
    return rows[0] ? toShippingDTO(rows[0]) : null;
  }

  async countSoldByVariantIds(
    variantIds: string[],
    opts?: { since?: Date },
  ): Promise<Record<string, number>> {
    if (variantIds.length === 0) return {};
    const rows = await this.db
      .select({
        variantId: schema.orderLineItem.variantId,
        count: sql<number>`sum(${schema.orderLineItem.quantity})::int`,
      })
      .from(schema.orderLineItem)
      .innerJoin(schema.order, eq(schema.orderLineItem.orderId, schema.order.id))
      .where(
        and(
          inArray(schema.orderLineItem.variantId, variantIds),
          inArray(schema.order.status, SOLD_STATUSES),
          // 时间窗（ADR-070）：传了 since 就只数这个时刻之后下单的，用来算「月销」。
          // 比较的是下单时间而不是付款时间——淘宝月销也按下单口径。
          opts?.since ? gte(schema.order.placedAt, opts.since) : undefined,
        ),
      )
      .groupBy(schema.orderLineItem.variantId);
    return Object.fromEntries(rows.map((r) => [r.variantId, Number(r.count ?? 0)]));
  }

  /** 销量排行 top N（统计报表，ADR-097）：按变体聚合销量，返回 [{variantId, quantity}]。 */
  async topSellingVariants(limit: number): Promise<Array<{ variantId: string; quantity: number }>> {
    const rows = await this.db
      .select({
        variantId: schema.orderLineItem.variantId,
        quantity: sql<number>`sum(${schema.orderLineItem.quantity})::int`,
      })
      .from(schema.orderLineItem)
      .innerJoin(schema.order, eq(schema.orderLineItem.orderId, schema.order.id))
      .where(inArray(schema.order.status, SOLD_STATUSES))
      .groupBy(schema.orderLineItem.variantId)
      .orderBy(desc(sql`sum(${schema.orderLineItem.quantity})`))
      .limit(limit);
    return rows.map((r) => ({ variantId: r.variantId, quantity: Number(r.quantity ?? 0) }));
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: schema.order.status, count: sql<number>`count(*)::int` })
      .from(schema.order)
      .groupBy(schema.order.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }

  async summarizePaidSince(
    since: Date,
  ): Promise<{ count: number; amountMinor: bigint; currencyCode: string | null }> {
    const rows = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${schema.order.totalMinor}), 0)::text`,
        currency: sql<string | null>`max(${schema.order.currencyCode})`,
      })
      .from(schema.order)
      .where(
        and(
          eq(schema.order.paymentStatus, "paid"),
          gte(schema.order.createdAt, since),
        ),
      );
    const row = rows[0];
    return {
      count: Number(row?.count ?? 0),
      amountMinor: BigInt(row?.amount ?? "0"),
      currencyCode: row?.currency ?? null,
    };
  }

  /** 时间段内已付款订单数与金额（统计报表，ADR-097）。 */
  async summarizePaidBetween(
    from: Date,
    to: Date,
  ): Promise<{ count: number; amountMinor: bigint; currencyCode: string | null }> {
    const rows = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${schema.order.totalMinor}), 0)::text`,
        currency: sql<string | null>`max(${schema.order.currencyCode})`,
      })
      .from(schema.order)
      .where(
        and(
          eq(schema.order.paymentStatus, "paid"),
          gte(schema.order.createdAt, from),
          lt(schema.order.createdAt, to),
        ),
      );
    const row = rows[0];
    return {
      count: Number(row?.count ?? 0),
      amountMinor: BigInt(row?.amount ?? "0"),
      currencyCode: row?.currency ?? null,
    };
  }

  /** 时间段内退款总额与笔数（统计报表，ADR-097）：只数已同意的退款单。 */
  async summarizeRefundsBetween(
    from: Date,
    to: Date,
  ): Promise<{ count: number; amountMinor: bigint; currencyCode: string | null }> {
    const rows = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${schema.refundRequest.amountMinor}), 0)::text`,
        currency: sql<string | null>`max(${schema.refundRequest.currencyCode})`,
      })
      .from(schema.refundRequest)
      .where(
        and(
          eq(schema.refundRequest.status, "approved"),
          gte(schema.refundRequest.reviewedAt, from),
          lt(schema.refundRequest.reviewedAt, to),
        ),
      );
    const row = rows[0];
    return {
      count: Number(row?.count ?? 0),
      amountMinor: BigInt(row?.amount ?? "0"),
      currencyCode: row?.currency ?? null,
    };
  }

  async list(q: OrderQuery): Promise<{ items: OrderDTO[]; count: number }> {
    const conditions = [
      q.status ? eq(schema.order.status, q.status) : null,
      // 后台页签用多状态（待发货 = paid + partially_fulfilled），单状态仍兼容
      q.statuses && q.statuses.length > 0 ? inArray(schema.order.status, q.statuses) : null,
      q.cartId ? eq(schema.order.cartId, q.cartId) : null,
      // 顾客列表必须带这个条件：漏了会把全店订单返回给任意顾客
      q.customerId ? eq(schema.order.customerId, q.customerId) : null,
      // 后台搜索：订单号或邮箱。不做标题搜索 —— 订单号是商家手里唯一的线索
      q.q
        ? or(
            ilike(schema.order.id, `%${q.q}%`),
            ilike(schema.order.email, `%${q.q}%`),
          )
        : null,
      // 下单时间范围（ADR-056）：商家按日期对账，边界都含
      q.createdFrom ? gte(schema.order.createdAt, q.createdFrom) : null,
      q.createdTo ? lte(schema.order.createdAt, q.createdTo) : null,
    ].filter((c): c is SQL => c !== null);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.db
      .select()
      .from(schema.order)
      .where(where)
      /*
       * B3 修复：按创建时间倒序。此前无排序，PG 返回顺序不保证 ——
       * 一辆车出两单时按 cart_id 反查拿到哪一笔不确定，支付会话可能挂错订单。
       * 倒序保证「最新一单」在最前，反查结果确定。
       */
      .orderBy(desc(schema.order.createdAt))
      .limit(q.limit ?? 20)
      .offset(q.offset ?? 0);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.order)
      .where(where);
    return { items: rows.map(toOrderDTO), count: countRows[0]?.count ?? 0 };
  }

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    await this.db.update(schema.order).set({ status, updatedAt: new Date() }).where(eq(schema.order.id, id));
  }

  /** 同步支付状态（订单进入 paid ⟺ 支付成功，order 不依赖 payment 模块，由事件驱动）。 */
  async updatePaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<void> {
    await this.db
      .update(schema.order)
      .set({ paymentStatus, updatedAt: new Date() })
      .where(eq(schema.order.id, id));
  }
}

function toRefundRequestDTO(
  r: typeof schema.refundRequest.$inferSelect,
  orderEmail?: string | null,
): RefundRequestDTO {
  return {
    id: r.id,
    order_id: r.orderId,
    customer_id: r.customerId ?? null,
    amount_minor: r.amountMinor,
    currency_code: r.currencyCode,
    reason: r.reason,
    source: r.source as RefundRequestDTO["source"],
    status: r.status as RefundRequestDTO["status"],
    resolution: (r.resolution as RefundRequestDTO["resolution"]) ?? "refund_only",
    return_address: r.returnAddress ?? null,
    return_carrier: r.returnCarrier ?? null,
    return_tracking_number: r.returnTrackingNumber ?? null,
    return_shipped_at: r.returnShippedAt ? r.returnShippedAt.toISOString() : null,
    return_received_at: r.returnReceivedAt ? r.returnReceivedAt.toISOString() : null,
    exchange_variant_id: r.exchangeVariantId ?? null,
    exchange_quantity: r.exchangeQuantity ?? 1,
    exchange_label: r.exchangeLabel ?? null,
    exchange_carrier: r.exchangeCarrier ?? null,
    exchange_tracking_number: r.exchangeTrackingNumber ?? null,
    exchange_shipped_at: r.exchangeShippedAt ? r.exchangeShippedAt.toISOString() : null,
    review_note: r.reviewNote ?? null,
    reviewed_at: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    refund_id: r.refundId ?? null,
    order_status_before: (r.orderStatusBefore as RefundRequestDTO["order_status_before"]) ?? null,
    created_at: r.createdAt.toISOString(),
    order_email: orderEmail ?? null,
  };
}

function toOrderDTO(r: typeof schema.order.$inferSelect): OrderDTO {
  return {
    id: r.id,
    status: r.status as OrderStatus,
    cart_id: r.cartId ?? null,
    customer_id: r.customerId ?? null,
    email: r.email,
    currency_code: r.currencyCode,
    channel_id: r.channelId,
    region_id: r.regionId,
    subtotal_minor: r.subtotalMinor,
    shipping_minor: r.shippingMinor,
    tax_minor: r.taxMinor,
    discount_minor: r.discountMinor,
    total_minor: r.totalMinor,
    payment_status: r.paymentStatus as PaymentStatus,
    shipping_address: (r.shippingAddress as Record<string, unknown>) ?? {},
    payment_collection_id: r.paymentCollectionId ?? null,
    merchant_note: r.merchantNote ?? null,
    customer_note: r.customerNote ?? null,
    placed_at: r.placedAt ? r.placedAt.toISOString() : null,
  };
}

function toLineItemDTO(r: typeof schema.orderLineItem.$inferSelect): OrderLineItemDTO {
  return {
    id: r.id,
    order_id: r.orderId,
    variant_id: r.variantId,
    product_id: r.productId,
    title: r.title,
    sku: r.sku,
    quantity: r.quantity,
    unit_price_minor: r.unitPriceMinor,
    tax_rate_bps: r.taxRateBps,
    tax_amount_minor: r.taxAmountMinor,
    total_minor: r.totalMinor,
    currency_code: r.currencyCode,
    options: (r.options as Record<string, string> | null) ?? null,
  };
}

function toShippingDTO(r: typeof schema.orderShippingMethod.$inferSelect): OrderShippingMethodDTO {
  return {
    id: r.id,
    order_id: r.orderId,
    name: r.name,
    carrier_name: r.carrierName ?? null,
    amount_minor: r.amountMinor,
    currency_code: r.currencyCode,
  };
}

function toOrderDiscountDTO(r: typeof schema.orderDiscount.$inferSelect): OrderDiscountDTO {
  return {
    id: r.id,
    order_id: r.orderId,
    promotion_id: r.promotionId,
    code: r.code ?? null,
    amount_minor: r.amountMinor,
    type: r.type as OrderDiscountType,
    created_at: r.createdAt,
  };
}
