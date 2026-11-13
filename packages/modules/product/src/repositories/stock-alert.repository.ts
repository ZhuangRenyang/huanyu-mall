import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type { StockAlertDTO, StockAlertRepository, SubscribeStockAlertInput } from "../types.js";

/** 到货提醒（ADR-059）：登记幂等 + 按变体取待通知 + 标记已通知。 */
export class DrizzleStockAlertRepository implements StockAlertRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async upsert(input: SubscribeStockAlertInput & { id: string }): Promise<StockAlertDTO> {
    /*
     * 重复点「到货提醒」是常态，不是错误：唯一索引兜住并发，
     * 冲突时什么都不做，再把已有那条读回来（前端拿到同一个 id，可以放心重试）。
     */
    const inserted = await this.db
      .insert(schema.stockAlert)
      .values({
        id: input.id,
        productId: input.productId,
        variantId: input.variantId,
        email: input.email,
        customerId: input.customerId ?? null,
      })
      .onConflictDoNothing({
        target: [schema.stockAlert.variantId, schema.stockAlert.email],
      })
      .returning();
    if (inserted[0]) return toDTO(inserted[0]);

    const existing = await this.db
      .select()
      .from(schema.stockAlert)
      .where(
        and(
          eq(schema.stockAlert.variantId, input.variantId),
          eq(schema.stockAlert.email, input.email),
        ),
      )
      .limit(1);
    return toDTO(existing[0]!);
  }

  async listPendingByVariantIds(variantIds: string[]): Promise<StockAlertDTO[]> {
    if (variantIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.stockAlert)
      .where(
        and(
          inArray(schema.stockAlert.variantId, variantIds),
          isNull(schema.stockAlert.notifiedAt),
        ),
      );
    return rows.map(toDTO);
  }

  async markNotified(ids: string[], at: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(schema.stockAlert)
      .set({ notifiedAt: at })
      .where(inArray(schema.stockAlert.id, ids))
      .returning({ id: schema.stockAlert.id });
    return rows.length;
  }

  async countPendingByVariantIds(variantIds: string[]): Promise<Record<string, number>> {
    if (variantIds.length === 0) return {};
    const rows = await this.db
      .select({ variantId: schema.stockAlert.variantId, n: sql<number>`count(*)::int` })
      .from(schema.stockAlert)
      .where(
        and(
          inArray(schema.stockAlert.variantId, variantIds),
          isNull(schema.stockAlert.notifiedAt),
        ),
      )
      .groupBy(schema.stockAlert.variantId);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.variantId] = Number(r.n);
    return out;
  }
}

function toDTO(r: typeof schema.stockAlert.$inferSelect): StockAlertDTO {
  return {
    id: r.id,
    product_id: r.productId,
    variant_id: r.variantId,
    email: r.email,
    customer_id: r.customerId ?? null,
    notified_at: r.notifiedAt ?? null,
    created_at: r.createdAt,
  };
}
