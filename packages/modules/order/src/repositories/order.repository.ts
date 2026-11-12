import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  Actor,
  CreateOrderDiscountInput,
  OrderDiscountDTO,
  OrderDiscountType,
  OrderDTO,
  OrderLineItemDTO,
  OrderQuery,
  OrderRepository,
  OrderShippingMethodDTO,
  OrderStatus,
  PaymentStatus,
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

  async findPendingRefundRequest(orderId: string): Promise<RefundRequestDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.refundRequest)
      .where(
        and(eq(schema.refundRequest.orderId, orderId), eq(schema.refundRequest.status, "pending")),
      )
      .limit(1);
    return rows[0] ? toRefundRequestDTO(rows[0]) : null;
  }

  async listRefundRequests(q: RefundRequestQuery): Promise<{ items: RefundRequestDTO[]; count: number }> {
    const where = q.status ? eq(schema.refundRequest.status, q.status) : undefined;
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

  async updateRefundRequest(
    id: string,
    patch: { status: RefundRequestStatus; reviewNote?: string | null; refundId?: string | null },
  ): Promise<RefundRequestDTO | null> {
    const rows = await this.db
      .update(schema.refundRequest)
      .set({
        status: patch.status,
        ...(patch.reviewNote !== undefined ? { reviewNote: patch.reviewNote } : {}),
        ...(patch.refundId !== undefined ? { refundId: patch.refundId } : {}),
        reviewedAt: new Date(),
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

  async findShippingMethod(orderId: string): Promise<OrderShippingMethodDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.orderShippingMethod)
      .where(eq(schema.orderShippingMethod.orderId, orderId))
      .limit(1);
    return rows[0] ? toShippingDTO(rows[0]) : null;
  }

  async list(q: OrderQuery): Promise<{ items: OrderDTO[]; count: number }> {
    const conditions = [
      q.status ? eq(schema.order.status, q.status) : null,
      q.cartId ? eq(schema.order.cartId, q.cartId) : null,
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
    review_note: r.reviewNote ?? null,
    reviewed_at: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    refund_id: r.refundId ?? null,
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
