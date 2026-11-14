import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import { giftCardNotFound, voucherCodeNotFound } from "../errors.js";
import * as schema from "../models/index.js";
import type {
  CollectedVoucherDTO,
  CreateGiftCardInput,
  CreatePromotionInput,
  CreatePromotionRuleInput,
  CreateVoucherCodeInput,
  CreateVoucherInput,
  GiftCardDTO,
  VoucherScopeDTO,
  VoucherScopeInput,
  GiftCardEventDTO,
  GiftCardEventType,
  ListQuery,
  MarketingFeature,
  MarketingFeatureDTO,
  PromotionDTO,
  PromotionListQuery,
  PromotionPredicate,
  PromotionRepository,
  PromotionRuleDTO,
  UpdateGiftCardInput,
  UpdatePromotionInput,
  UpdateVoucherInput,
  VoucherCodeDTO,
  VoucherDTO,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzlePromotionRepository implements PromotionRepository {
  constructor(private readonly db: Db) {}

  // —— 功能开关（默认关闭）——

  async listFeatureFlags(): Promise<MarketingFeatureDTO[]> {
    const rows = await this.db.select().from(schema.promotionFeature);
    return rows.map((r) => ({ feature: r.feature as MarketingFeature, enabled: r.enabled }));
  }

  async setFeatureEnabled(feature: MarketingFeature, enabled: boolean): Promise<void> {
    const now = new Date();
    await this.db
      .insert(schema.promotionFeature)
      .values({ feature, enabled, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.promotionFeature.feature,
        set: { enabled, updatedAt: now },
      });
  }

  // —— promotion ——
  async insertPromotion(input: CreatePromotionInput & { id: string }): Promise<PromotionDTO> {
    const rows = await this.db
      .insert(schema.promotion)
      .values({
        id: input.id,
        name: input.name,
        code: input.code ?? null,
        type: input.type,
        status: input.status ?? "draft",
        isAutomatic: input.isAutomatic ?? false,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        usageLimit: input.usageLimit ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();
    return toPromotionDTO(rows[0]!);
  }

  async findPromotionById(id: string): Promise<PromotionDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.promotion)
      .where(and(eq(schema.promotion.id, id), isNull(schema.promotion.deletedAt)))
      .limit(1);
    return rows[0] ? toPromotionDTO(rows[0]) : null;
  }

  async listPromotions(q: PromotionListQuery): Promise<{ items: PromotionDTO[]; count: number }> {
    const where = and(
      isNull(schema.promotion.deletedAt),
      q.type ? eq(schema.promotion.type, q.type) : undefined,
      q.status ? eq(schema.promotion.status, q.status) : undefined,
      // 搜索名称或活动码：商家手里可能只有一个码
      q.q
        ? or(
            ilike(schema.promotion.name, `%${q.q}%`),
            ilike(schema.promotion.code, `%${q.q}%`),
          )
        : undefined,
    );
    const rows = await this.db
      .select()
      .from(schema.promotion)
      .where(where)
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.promotion)
      .where(where);
    return { items: rows.map(toPromotionDTO), count: countRows[0]?.count ?? 0 };
  }

  async updatePromotion(id: string, patch: UpdatePromotionInput): Promise<PromotionDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.code !== undefined) set.code = patch.code;
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.isAutomatic !== undefined) set.isAutomatic = patch.isAutomatic;
    if (patch.startsAt !== undefined) set.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) set.endsAt = patch.endsAt;
    if (patch.usageLimit !== undefined) set.usageLimit = patch.usageLimit;
    if (patch.metadata !== undefined) set.metadata = patch.metadata;
    const rows = await this.db
      .update(schema.promotion)
      .set(set)
      .where(eq(schema.promotion.id, id))
      .returning();
    return rows[0] ? toPromotionDTO(rows[0]) : null;
  }

  async softDeletePromotion(id: string): Promise<void> {
    await this.db
      .update(schema.promotion)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.promotion.id, id));
  }

  async listActiveCataloguePromotionsWithRules(
    now: Date,
  ): Promise<Array<{ promotion: PromotionDTO; rules: PromotionRuleDTO[] }>> {
    const promos = await this.db
      .select()
      .from(schema.promotion)
      .where(
        and(
          eq(schema.promotion.type, "catalogue"),
          eq(schema.promotion.status, "active"),
          isNull(schema.promotion.deletedAt),
          or(isNull(schema.promotion.startsAt), lte(schema.promotion.startsAt, now)),
          or(isNull(schema.promotion.endsAt), gte(schema.promotion.endsAt, now)),
        ),
      );
    if (promos.length === 0) return [];

    const ruleRows = await this.db
      .select()
      .from(schema.promotionRule)
      .where(
        and(
          inArray(
            schema.promotionRule.promotionId,
            promos.map((p) => p.id),
          ),
          isNull(schema.promotionRule.deletedAt),
        ),
      );
    const rulesByPromo = new Map<string, PromotionRuleDTO[]>();
    for (const r of ruleRows) {
      const list = rulesByPromo.get(r.promotionId) ?? [];
      list.push(toPromotionRuleDTO(r));
      rulesByPromo.set(r.promotionId, list);
    }
    return promos.map((p) => ({ promotion: toPromotionDTO(p), rules: rulesByPromo.get(p.id) ?? [] }));
  }

  async listActiveOrderPromotionsWithRules(
    now: Date,
  ): Promise<Array<{ promotion: PromotionDTO; rules: PromotionRuleDTO[] }>> {
    const promos = await this.db
      .select()
      .from(schema.promotion)
      .where(
        and(
          eq(schema.promotion.type, "order"),
          eq(schema.promotion.status, "active"),
          isNull(schema.promotion.deletedAt),
          or(isNull(schema.promotion.startsAt), lte(schema.promotion.startsAt, now)),
          or(isNull(schema.promotion.endsAt), gte(schema.promotion.endsAt, now)),
        ),
      );
    if (promos.length === 0) return [];

    const ruleRows = await this.db
      .select()
      .from(schema.promotionRule)
      .where(
        and(
          inArray(
            schema.promotionRule.promotionId,
            promos.map((p) => p.id),
          ),
          isNull(schema.promotionRule.deletedAt),
        ),
      );
    const rulesByPromo = new Map<string, PromotionRuleDTO[]>();
    for (const r of ruleRows) {
      const list = rulesByPromo.get(r.promotionId) ?? [];
      list.push(toPromotionRuleDTO(r));
      rulesByPromo.set(r.promotionId, list);
    }
    return promos.map((p) => ({ promotion: toPromotionDTO(p), rules: rulesByPromo.get(p.id) ?? [] }));
  }
  async insertPromotionRule(input: CreatePromotionRuleInput & { id: string }): Promise<PromotionRuleDTO> {
    const rows = await this.db
      .insert(schema.promotionRule)
      .values({
        id: input.id,
        promotionId: input.promotionId,
        predicate: input.predicate ?? {},
        rewardType: input.rewardType,
        rewardValue: input.rewardValue,
        allocation: input.allocation ?? null,
      })
      .returning();
    return toPromotionRuleDTO(rows[0]!);
  }

  async findPromotionRuleById(id: string): Promise<PromotionRuleDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.promotionRule)
      .where(and(eq(schema.promotionRule.id, id), isNull(schema.promotionRule.deletedAt)))
      .limit(1);
    return rows[0] ? toPromotionRuleDTO(rows[0]) : null;
  }

  async listRulesByPromotion(promotionId: string): Promise<PromotionRuleDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.promotionRule)
      .where(
        and(eq(schema.promotionRule.promotionId, promotionId), isNull(schema.promotionRule.deletedAt)),
      );
    return rows.map(toPromotionRuleDTO);
  }

  async softDeletePromotionRule(id: string): Promise<void> {
    await this.db
      .update(schema.promotionRule)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.promotionRule.id, id));
  }

  // —— voucher ——
  async insertVoucher(input: CreateVoucherInput & { id: string }): Promise<VoucherDTO> {
    const rows = await this.db
      .insert(schema.voucher)
      .values({
        id: input.id,
        name: input.name,
        type: input.type ?? "entire_order",
        usageLimit: input.usageLimit ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minSpent: input.minSpent ?? null,
        status: input.status ?? "active",
        isPublic: input.isPublic ?? false,
        collectLimit: input.collectLimit ?? 1,
        validDays: input.validDays ?? null,
      })
      .returning();
    return toVoucherDTO(rows[0]!);
  }

  async findVoucherById(id: string): Promise<VoucherDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.voucher)
      .where(and(eq(schema.voucher.id, id), isNull(schema.voucher.deletedAt)))
      .limit(1);
    return rows[0] ? toVoucherDTO(rows[0]) : null;
  }

  async listVouchers(q: ListQuery): Promise<{ items: VoucherDTO[]; count: number }> {
    const where = and(
      isNull(schema.voucher.deletedAt),
      q.q ? ilike(schema.voucher.name, `%${q.q}%`) : undefined,
    );
    const rows = await this.db
      .select()
      .from(schema.voucher)
      .where(where)
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.voucher)
      .where(where);
    return { items: rows.map(toVoucherDTO), count: countRows[0]?.count ?? 0 };
  }

  async updateVoucher(id: string, patch: UpdateVoucherInput): Promise<VoucherDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.usageLimit !== undefined) set.usageLimit = patch.usageLimit;
    if (patch.startsAt !== undefined) set.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) set.endsAt = patch.endsAt;
    if (patch.discountType !== undefined) set.discountType = patch.discountType;
    if (patch.discountValue !== undefined) set.discountValue = patch.discountValue;
    if (patch.minSpent !== undefined) set.minSpent = patch.minSpent;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.isPublic !== undefined) set.isPublic = patch.isPublic;
    if (patch.collectLimit !== undefined) set.collectLimit = patch.collectLimit;
    if (patch.validDays !== undefined) set.validDays = patch.validDays;
    const rows = await this.db
      .update(schema.voucher)
      .set(set)
      .where(eq(schema.voucher.id, id))
      .returning();
    return rows[0] ? toVoucherDTO(rows[0]) : null;
  }

  // —— voucher_scope（ADR-064）——

  async listScopesByVoucherIds(voucherIds: string[]): Promise<Record<string, VoucherScopeDTO[]>> {
    const out: Record<string, VoucherScopeDTO[]> = {};
    if (voucherIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(schema.voucherScope)
      .where(inArray(schema.voucherScope.voucherId, voucherIds));
    for (const r of rows) {
      const dto = toVoucherScopeDTO(r);
      (out[dto.voucher_id] ??= []).push(dto);
    }
    return out;
  }

  async listScopesByVoucherId(voucherId: string): Promise<VoucherScopeDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.voucherScope)
      .where(eq(schema.voucherScope.voucherId, voucherId));
    return rows.map(toVoucherScopeDTO);
  }

  async replaceScopes(voucherId: string, scopes: VoucherScopeInput[]): Promise<void> {
    await this.db.delete(schema.voucherScope).where(eq(schema.voucherScope.voucherId, voucherId));
    if (scopes.length === 0) return;
    // 去重：重复勾选是常态，别让唯一索引抛错
    const seen = new Set<string>();
    const rows = scopes
      .filter((s) => {
        const key = `${s.scopeType}:${s.scopeId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((s) => ({
        id: prefixedUlid("vscope"),
        voucherId,
        scopeType: s.scopeType,
        scopeId: s.scopeId,
      }));
    await this.db.insert(schema.voucherScope).values(rows);
  }

  async softDeleteVoucher(id: string): Promise<void> {
    await this.db
      .update(schema.voucher)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.voucher.id, id));
  }

  // —— voucher_collection（ADR-029）——

  async insertVoucherCollection(input: {
    id: string;
    voucherId: string;
    customerId: string;
    codeId: string;
  }): Promise<void> {
    await this.db.insert(schema.voucherCollection).values({
      id: input.id,
      voucherId: input.voucherId,
      customerId: input.customerId,
      codeId: input.codeId,
    });
  }

  async countVoucherCollections(voucherId: string, customerId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.voucherCollection)
      .where(
        and(
          eq(schema.voucherCollection.voucherId, voucherId),
          eq(schema.voucherCollection.customerId, customerId),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async listVoucherCollectionsByCustomer(customerId: string): Promise<CollectedVoucherDTO[]> {
    const rows = await this.db
      .select({
        collection: schema.voucherCollection,
        code: schema.voucherCode,
        voucher: schema.voucher,
      })
      .from(schema.voucherCollection)
      .innerJoin(schema.voucherCode, eq(schema.voucherCode.id, schema.voucherCollection.codeId))
      .innerJoin(schema.voucher, eq(schema.voucher.id, schema.voucherCollection.voucherId))
      .where(
        and(
          eq(schema.voucherCollection.customerId, customerId),
          isNull(schema.voucher.deletedAt),
        ),
      )
      .orderBy(desc(schema.voucherCollection.collectedAt));
    return rows.map((r) => toCollectedVoucherDTO(r));
  }

  async findVoucherCollection(
    voucherId: string,
    customerId: string,
  ): Promise<{ code: string } | null> {
    const rows = await this.db
      .select({ code: schema.voucherCode.code })
      .from(schema.voucherCollection)
      .innerJoin(schema.voucherCode, eq(schema.voucherCode.id, schema.voucherCollection.codeId))
      .where(
        and(
          eq(schema.voucherCollection.voucherId, voucherId),
          eq(schema.voucherCollection.customerId, customerId),
        ),
      )
      .orderBy(desc(schema.voucherCollection.collectedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async markCollectionUsedByCode(codeId: string): Promise<void> {
    await this.db
      .update(schema.voucherCollection)
      .set({ status: "used", usedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(schema.voucherCollection.codeId, codeId), eq(schema.voucherCollection.status, "unused")),
      );
  }

  async markCollectionUnusedByCode(codeId: string): Promise<void> {
    await this.db
      .update(schema.voucherCollection)
      .set({ status: "unused", usedAt: null, updatedAt: new Date() })
      .where(eq(schema.voucherCollection.codeId, codeId));
  }

  // —— voucher_code ——
  async setVoucherCodeExpiry(id: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(schema.voucherCode)
      .set({ expiresAt, updatedAt: new Date() })
      .where(eq(schema.voucherCode.id, id));
  }

  async insertVoucherCode(input: CreateVoucherCodeInput & { id: string }): Promise<VoucherCodeDTO> {
    const rows = await this.db
      .insert(schema.voucherCode)
      .values({
        id: input.id,
        voucherId: input.voucherId,
        code: input.code,
        isActive: input.isActive ?? true,
      })
      .returning();
    return toVoucherCodeDTO(rows[0]!);
  }

  async findVoucherCodeById(id: string): Promise<VoucherCodeDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.voucherCode)
      .where(and(eq(schema.voucherCode.id, id), isNull(schema.voucherCode.deletedAt)))
      .limit(1);
    return rows[0] ? toVoucherCodeDTO(rows[0]) : null;
  }

  async findVoucherCodeByCode(code: string): Promise<VoucherCodeDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.voucherCode)
      .where(and(eq(schema.voucherCode.code, code), isNull(schema.voucherCode.deletedAt)))
      .limit(1);
    return rows[0] ? toVoucherCodeDTO(rows[0]) : null;
  }

  async findVoucherCodeWithVoucherByCode(
    code: string,
  ): Promise<{ code: VoucherCodeDTO; voucher: VoucherDTO } | null> {
    const rows = await this.db
      .select()
      .from(schema.voucherCode)
      .innerJoin(schema.voucher, eq(schema.voucher.id, schema.voucherCode.voucherId))
      .where(
        and(
          eq(schema.voucherCode.code, code),
          isNull(schema.voucherCode.deletedAt),
          isNull(schema.voucher.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { code: toVoucherCodeDTO(row.voucher_code), voucher: toVoucherDTO(row.voucher) };
  }

  async listCodesByVoucher(voucherId: string): Promise<VoucherCodeDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.voucherCode)
      .where(
        and(eq(schema.voucherCode.voucherId, voucherId), isNull(schema.voucherCode.deletedAt)),
      );
    return rows.map(toVoucherCodeDTO);
  }

  async updateVoucherCode(codeId: string, patch: { isActive?: boolean }): Promise<VoucherCodeDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    const rows = await this.db
      .update(schema.voucherCode)
      .set(set)
      .where(eq(schema.voucherCode.id, codeId))
      .returning();
    return rows[0] ? toVoucherCodeDTO(rows[0]) : null;
  }

  async softDeleteVoucherCode(id: string): Promise<void> {
    await this.db
      .update(schema.voucherCode)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.voucherCode.id, id));
  }

  async incrementVoucherCodeUsed(
    codeId: string,
  ): Promise<{ used: number; usageLimit: number | null; exceeded: boolean }> {
    /*
     * 资金安全硬约束 3：检查限额 + 自增必须原子，不能「先查后写」产生竞态。
     * 事务内用 `FOR UPDATE OF vc` 对 voucher_code 行加锁：并发下单同码时，
     * 后到事务阻塞在前一个事务提交后，重读到的 used 已是自增后的值，
     * 从而保证「同一 code 不会超用」。
     */
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT vc.used, v.usage_limit
        FROM voucher_code vc
        JOIN voucher v ON v.id = vc.voucher_id
        WHERE vc.id = ${codeId} AND vc.deleted_at IS NULL
        FOR UPDATE OF vc
      `);
      const row = locked.rows[0] as { used: number; usage_limit: number | null } | undefined;
      if (!row) throw voucherCodeNotFound(codeId);
      if (row.usage_limit !== null && row.used >= row.usage_limit) {
        return { used: row.used, usageLimit: row.usage_limit, exceeded: true };
      }
      const updated = await tx.execute(sql`
        UPDATE voucher_code
        SET used = used + 1, updated_at = now()
        WHERE id = ${codeId}
        RETURNING used
      `);
      const used = (updated.rows[0] as { used: number }).used;
      return { used, usageLimit: row.usage_limit, exceeded: false };
    });
  }

  async releaseVoucherCodeUsed(codeId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE voucher_code
      SET used = GREATEST(used - 1, 0), updated_at = now()
      WHERE id = ${codeId}
    `);
  }

  // —— gift_card ——
  async insertGiftCard(input: CreateGiftCardInput & { id: string }): Promise<GiftCardDTO> {
    const rows = await this.db
      .insert(schema.giftCard)
      .values({
        id: input.id,
        code: input.code,
        currency: input.currency,
        initialBalance: input.initialBalance,
        currentBalance: input.initialBalance,
        isActive: input.isActive ?? true,
        expiresAt: input.expiresAt ?? null,
        assignedTo: input.assignedTo ?? null,
      })
      .returning();
    return toGiftCardDTO(rows[0]!);
  }

  async findGiftCardById(id: string): Promise<GiftCardDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.giftCard)
      .where(and(eq(schema.giftCard.id, id), isNull(schema.giftCard.deletedAt)))
      .limit(1);
    return rows[0] ? toGiftCardDTO(rows[0]) : null;
  }

  async findGiftCardByCode(code: string): Promise<GiftCardDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.giftCard)
      .where(and(eq(schema.giftCard.code, code), isNull(schema.giftCard.deletedAt)))
      .limit(1);
    return rows[0] ? toGiftCardDTO(rows[0]) : null;
  }

  async listGiftCards(q: ListQuery): Promise<{ items: GiftCardDTO[]; count: number }> {
    const where = and(
      isNull(schema.giftCard.deletedAt),
      // 礼品卡按卡号搜：商家拿到的是卡号，不是「哪张卡」
      q.q ? ilike(schema.giftCard.code, `%${q.q}%`) : undefined,
    );
    const rows = await this.db
      .select()
      .from(schema.giftCard)
      .where(where)
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.giftCard)
      .where(where);
    return { items: rows.map(toGiftCardDTO), count: countRows[0]?.count ?? 0 };
  }

  async updateGiftCard(id: string, patch: UpdateGiftCardInput): Promise<GiftCardDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.code !== undefined) set.code = patch.code;
    if (patch.currency !== undefined) set.currency = patch.currency;
    if (patch.initialBalance !== undefined) set.initialBalance = patch.initialBalance;
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
    if (patch.assignedTo !== undefined) set.assignedTo = patch.assignedTo;
    const rows = await this.db
      .update(schema.giftCard)
      .set(set)
      .where(eq(schema.giftCard.id, id))
      .returning();
    return rows[0] ? toGiftCardDTO(rows[0]) : null;
  }

  async softDeleteGiftCard(id: string): Promise<void> {
    await this.db
      .update(schema.giftCard)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.giftCard.id, id));
  }

  async deductGiftCardBalance(
    cardId: string,
    amountMinor: bigint,
  ): Promise<{ balance: bigint; insufficient: boolean }> {
    /*
     * 资金安全硬约束 3：余额扣减必须行锁 + 事务原子，不能「先查后写」产生竞态。
     * 事务内 `SELECT ... FOR UPDATE` 锁 gift_card 行：并发下单同卡时，
     * 后到事务阻塞在前一个事务提交后，重读到的 current_balance 已是扣减后的值，
     * 从而保证「同一张卡不会被并发套现超扣」。
     * 余额不足返回 insufficient:true（不扣），余额非负由 DB CHECK 约束兜底。
     */
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT current_balance
        FROM gift_card
        WHERE id = ${cardId} AND deleted_at IS NULL
        FOR UPDATE
      `);
      const row = locked.rows[0] as { current_balance: string | bigint } | undefined;
      if (!row) throw giftCardNotFound(cardId);
      const current = BigInt(row.current_balance);
      if (current < amountMinor) {
        return { balance: current, insufficient: true };
      }
      const updated = await tx.execute(sql`
        UPDATE gift_card
        SET current_balance = current_balance - ${amountMinor}, updated_at = now()
        WHERE id = ${cardId}
        RETURNING current_balance
      `);
      const balance = BigInt((updated.rows[0] as { current_balance: string | bigint }).current_balance);
      return { balance, insufficient: false };
    });
  }

  async refundGiftCardBalance(cardId: string, amountMinor: bigint): Promise<void> {
    await this.db.execute(sql`
      UPDATE gift_card
      SET current_balance = current_balance + ${amountMinor}, updated_at = now()
      WHERE id = ${cardId} AND deleted_at IS NULL
    `);
  }

  // —— gift_card_event ——
  async insertGiftCardEvent(input: {
    id: string;
    giftCardId: string;
    type: GiftCardEventType;
    amount: bigint;
    orderId?: string | null;
    parameters?: Record<string, unknown> | null;
  }): Promise<GiftCardEventDTO> {
    const rows = await this.db
      .insert(schema.giftCardEvent)
      .values({
        id: input.id,
        giftCardId: input.giftCardId,
        type: input.type,
        amount: input.amount,
        orderId: input.orderId ?? null,
        parameters: input.parameters ?? null,
      })
      .returning();
    return toGiftCardEventDTO(rows[0]!);
  }

  async listEventsByGiftCard(giftCardId: string): Promise<GiftCardEventDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.giftCardEvent)
      .where(eq(schema.giftCardEvent.giftCardId, giftCardId));
    return rows.map(toGiftCardEventDTO);
  }
}

// —— DTO 映射 ——
function toPromotionDTO(r: typeof schema.promotion.$inferSelect): PromotionDTO {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    type: r.type as PromotionDTO["type"],
    status: r.status as PromotionDTO["status"],
    is_automatic: r.isAutomatic,
    starts_at: r.startsAt,
    ends_at: r.endsAt,
    usage_limit: r.usageLimit,
    used: r.used,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  };
}

function toPromotionRuleDTO(r: typeof schema.promotionRule.$inferSelect): PromotionRuleDTO {
  return {
    id: r.id,
    promotion_id: r.promotionId,
    predicate: (r.predicate as PromotionPredicate) ?? {},
    reward_type: r.rewardType as PromotionRuleDTO["reward_type"],
    reward_value: r.rewardValue,
    allocation: (r.allocation as PromotionRuleDTO["allocation"]) ?? null,
  };
}

function toVoucherDTO(r: typeof schema.voucher.$inferSelect): VoucherDTO {
  return {
    id: r.id,
    name: r.name,
    type: r.type as VoucherDTO["type"],
    usage_limit: r.usageLimit,
    starts_at: r.startsAt,
    ends_at: r.endsAt,
    discount_type: r.discountType as VoucherDTO["discount_type"],
    discount_value: r.discountValue,
    min_spent: r.minSpent,
    status: r.status as VoucherDTO["status"],
    is_public: r.isPublic,
    collect_limit: r.collectLimit,
    valid_days: r.validDays,
  };
}

function toVoucherScopeDTO(r: typeof schema.voucherScope.$inferSelect): VoucherScopeDTO {
  return {
    id: r.id,
    voucher_id: r.voucherId,
    scope_type: r.scopeType as VoucherScopeDTO["scope_type"],
    scope_id: r.scopeId,
  };
}

function toVoucherCodeDTO(r: typeof schema.voucherCode.$inferSelect): VoucherCodeDTO {
  return {
    id: r.id,
    voucher_id: r.voucherId,
    code: r.code,
    used: r.used,
    is_active: r.isActive,
    expires_at: r.expiresAt,
  };
}

function toGiftCardDTO(r: typeof schema.giftCard.$inferSelect): GiftCardDTO {
  return {
    id: r.id,
    code: r.code,
    currency: r.currency,
    initial_balance: r.initialBalance,
    current_balance: r.currentBalance,
    is_active: r.isActive,
    expires_at: r.expiresAt,
    assigned_to: r.assignedTo,
  };
}

function toGiftCardEventDTO(r: typeof schema.giftCardEvent.$inferSelect): GiftCardEventDTO {
  return {
    id: r.id,
    gift_card_id: r.giftCardId,
    type: r.type as GiftCardEventDTO["type"],
    amount: r.amount,
    order_id: r.orderId,
    parameters: (r.parameters as Record<string, unknown> | null) ?? null,
    created_at: r.createdAt,
  };
}

function toCollectedVoucherDTO(r: {
  collection: typeof schema.voucherCollection.$inferSelect;
  code: typeof schema.voucherCode.$inferSelect;
  voucher: typeof schema.voucher.$inferSelect;
}): CollectedVoucherDTO {
  return {
    id: r.collection.id,
    voucher_id: r.collection.voucherId,
    code: r.code.code,
    name: r.voucher.name,
    type: r.voucher.type as CollectedVoucherDTO["type"],
    discount_type: r.voucher.discountType as CollectedVoucherDTO["discount_type"],
    discount_value: r.voucher.discountValue,
    min_spent: r.voucher.minSpent,
    starts_at: r.voucher.startsAt,
    // 码级到期（领取后 N 天）与券的固定 ends_at 取更早的那个（ADR-085）
    ends_at:
      r.code.expiresAt && r.voucher.endsAt
        ? r.code.expiresAt < r.voucher.endsAt
          ? r.code.expiresAt
          : r.voucher.endsAt
        : (r.code.expiresAt ?? r.voucher.endsAt),
    status: r.collection.status as CollectedVoucherDTO["status"],
    collected_at: r.collection.collectedAt,
    used_at: r.collection.usedAt,
  };
}
