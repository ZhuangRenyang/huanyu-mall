import { and, eq, sql, type SQL } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  Actor,
  OrderDTO,
  OrderLineItemDTO,
  OrderQuery,
  OrderRepository,
  OrderShippingMethodDTO,
  OrderStatus,
  PaymentStatus,
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
