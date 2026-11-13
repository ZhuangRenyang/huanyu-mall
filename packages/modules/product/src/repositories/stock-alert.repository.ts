import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type { StockAlertDTO, StockAlertRepository, SubscribeStockAlertInput } from "../types.js";

/** 到货提醒（ADR-059）：登记幂等 + 按变体取待通知 + 标记已通知。 */
export class DrizzleStockAlertRepository implements StockAlertRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async upsert(input: SubscribeStockAlertInput & { id: string }): Promise<StockAlertDTO> {
    /*
     * 重复点「到货提醒」是常态，不是错误：唯一索引兜住并发，
     * 冲突时**刷新**已有那条（ADR-069）：
     *   - created_at 置为当前时间 → 有效期重新起算；
     *   - notified_at 清空 → 之前发过「到货了」的话，这次补货还能再收到一封。
     *
     * 不刷新就会白登记：老登记 notified_at 已置位、又被有效期过滤掉，
     * 顾客明明重新点了提醒，却再也不会收到任何邮件。
     */
    const rows = await this.db
      .insert(schema.stockAlert)
      .values({
        id: input.id,
        productId: input.productId,
        variantId: input.variantId,
        email: input.email,
        customerId: input.customerId ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.stockAlert.variantId, schema.stockAlert.email],
        set: { createdAt: new Date(), notifiedAt: null },
      })
      .returning();
    if (rows[0]) return toDTO(rows[0]);

    // 理论上到不了这里（冲突一定会更新），兜底读一次而不是抛错
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
