import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  ListReviewsQuery,
  ReviewDTO,
  ReviewRepository,
  ReviewSummaryDTO,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleReviewRepository implements ReviewRepository {
  constructor(private readonly db: Db) {}

  async insert(input: {
    id: string;
    productId: string;
    productTitle: string;
    orderId: string;
    customerId: string;
    customerName: string;
    rating: number;
    content: string;
  }): Promise<ReviewDTO> {
    const rows = await this.db
      .insert(schema.productReview)
      .values({
        id: input.id || prefixedUlid("rev"),
        productId: input.productId,
        productTitle: input.productTitle,
        orderId: input.orderId,
        customerId: input.customerId,
        customerName: input.customerName,
        rating: input.rating,
        content: input.content,
      })
      .returning();
    return toReviewDTO(rows[0]!);
  }

  async findById(id: string): Promise<ReviewDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.productReview)
      .where(and(eq(schema.productReview.id, id), isNull(schema.productReview.deletedAt)))
      .limit(1);
    return rows[0] ? toReviewDTO(rows[0]) : null;
  }

  async findByOrderProduct(
    orderId: string,
    productId: string,
    customerId: string,
  ): Promise<ReviewDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.productReview)
      .where(
        and(
          eq(schema.productReview.orderId, orderId),
          eq(schema.productReview.productId, productId),
          eq(schema.productReview.customerId, customerId),
          isNull(schema.productReview.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toReviewDTO(rows[0]) : null;
  }

  async listByProduct(
    productId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: ReviewDTO[]; count: number }> {
    const where = and(
      eq(schema.productReview.productId, productId),
      eq(schema.productReview.isVisible, true),
      isNull(schema.productReview.deletedAt),
    );
    const rows = await this.db
      .select()
      .from(schema.productReview)
      .where(where)
      .orderBy(desc(schema.productReview.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.productReview)
      .where(where);
    return { items: rows.map(toReviewDTO), count: Number(countRows[0]?.count ?? 0) };
  }

  async summaryByProduct(productId: string): Promise<ReviewSummaryDTO> {
    const rows = await this.db
      .select({
        rating: schema.productReview.rating,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.productReview)
      .where(
        and(
          eq(schema.productReview.productId, productId),
          eq(schema.productReview.isVisible, true),
          isNull(schema.productReview.deletedAt),
        ),
      )
      .groupBy(schema.productReview.rating);

    const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    let count = 0;
    let sum = 0;
    for (const row of rows) {
      const n = Number(row.count);
      distribution[String(row.rating)] = n;
      count += n;
      sum += n * row.rating;
    }
    // 一位小数：详情页显示 4.8，不在前端二次取整（两边取整会不一致）
    return { average: count > 0 ? Math.round((sum / count) * 10) / 10 : null, count, distribution };
  }

  async listByCustomer(
    customerId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: ReviewDTO[]; count: number }> {
    const where = and(
      eq(schema.productReview.customerId, customerId),
      isNull(schema.productReview.deletedAt),
    );
    const rows = await this.db
      .select()
      .from(schema.productReview)
      .where(where)
      .orderBy(desc(schema.productReview.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.productReview)
      .where(where);
    return { items: rows.map(toReviewDTO), count: Number(countRows[0]?.count ?? 0) };
  }

  async list(q: ListReviewsQuery): Promise<{ items: ReviewDTO[]; count: number }> {
    const conditions: SQL[] = [isNull(schema.productReview.deletedAt)];
    if (q.productId) conditions.push(eq(schema.productReview.productId, q.productId));
    if (q.visible !== undefined) conditions.push(eq(schema.productReview.isVisible, q.visible));
    const where = and(...conditions);
    const rows = await this.db
      .select()
      .from(schema.productReview)
      .where(where)
      .orderBy(desc(schema.productReview.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.productReview)
      .where(where);
    return { items: rows.map(toReviewDTO), count: Number(countRows[0]?.count ?? 0) };
  }

  async listByOrder(orderId: string): Promise<ReviewDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.productReview)
      .where(
        and(eq(schema.productReview.orderId, orderId), isNull(schema.productReview.deletedAt)),
      );
    return rows.map(toReviewDTO);
  }

  async setVisible(id: string, visible: boolean): Promise<ReviewDTO | null> {
    const rows = await this.db
      .update(schema.productReview)
      .set({ isVisible: visible, updatedAt: new Date() })
      .where(and(eq(schema.productReview.id, id), isNull(schema.productReview.deletedAt)))
      .returning();
    return rows[0] ? toReviewDTO(rows[0]) : null;
  }

  async setReply(id: string, reply: string | null): Promise<ReviewDTO | null> {
    const rows = await this.db
      .update(schema.productReview)
      .set({
        reply,
        repliedAt: reply ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.productReview.id, id), isNull(schema.productReview.deletedAt)))
      .returning();
    return rows[0] ? toReviewDTO(rows[0]) : null;
  }
}

function toReviewDTO(r: typeof schema.productReview.$inferSelect): ReviewDTO {
  return {
    id: r.id,
    product_id: r.productId,
    product_title: r.productTitle,
    order_id: r.orderId,
    customer_id: r.customerId,
    customer_name: r.customerName,
    rating: r.rating,
    content: r.content,
    is_visible: r.isVisible,
    reply: r.reply ?? null,
    replied_at: r.repliedAt ?? null,
    created_at: r.createdAt,
  };
}
