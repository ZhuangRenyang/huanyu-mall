import { describe, expect, it } from "vitest";
import { giftCardNotFound, voucherCodeNotFound } from "../src/errors.js";
import {
  pointDiscountMinor,
  pointsEarnedFromPaid,
  PromotionService,
  voucherCodeExpiry,
  voucherIncludesItem,
} from "../src/services/promotion.service.js";
import type {
  CollectedVoucherDTO,
  CreateGiftCardInput,
  CreatePromotionInput,
  CreatePromotionRuleInput,
  CreateVoucherCodeInput,
  CreateVoucherInput,
  GiftCardDTO,
  GiftCardEventDTO,
  GiftCardEventType,
  ListQuery,
  MarketingFeature,
  MarketingFeatureDTO,
  PointLedgerDTO,
  PointLedgerKind,
  PromotionDTO,
  PromotionRepository,
  PromotionRuleDTO,
  UpdateGiftCardInput,
  UpdatePromotionInput,
  UpdateVoucherInput,
  VoucherCodeDTO,
  VoucherDTO,
} from "../src/types.js";

class InMemoryPromotionRepository implements PromotionRepository {
  promotions = new Map<string, PromotionDTO>();
  rules = new Map<string, PromotionRuleDTO>();
  vouchers = new Map<string, VoucherDTO>();
  collections: Array<{
    id: string;
    voucherId: string;
    customerId: string;
    codeId: string;
    status: "unused" | "used";
    collectedAt: Date;
    usedAt: Date | null;
  }> = [];
  voucherCodes = new Map<string, VoucherCodeDTO>();
  giftCards = new Map<string, GiftCardDTO>();
  giftCardEvents = new Map<string, GiftCardEventDTO[]>();
  /** 测试默认三个功能全开；关闭语义单测里显式改。 */
  featureFlags = new Map<MarketingFeature, boolean>([
    ["promotion", true],
    ["voucher", true],
    ["gift_card", true],
  ]);

  async listFeatureFlags(): Promise<MarketingFeatureDTO[]> {
    return [...this.featureFlags].map(([feature, enabled]) => ({ feature, enabled }));
  }

  async setFeatureEnabled(feature: MarketingFeature, enabled: boolean): Promise<void> {
    this.featureFlags.set(feature, enabled);
  }

  async insertPromotion(input: CreatePromotionInput & { id: string }): Promise<PromotionDTO> {
    const dto: PromotionDTO = {
      id: input.id,
      name: input.name,
      code: input.code ?? null,
      type: input.type,
      status: input.status ?? "draft",
      is_automatic: input.isAutomatic ?? false,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      usage_limit: input.usageLimit ?? null,
      used: 0,
      metadata: input.metadata ?? null,
    };
    this.promotions.set(dto.id, dto);
    return dto;
  }
  async findPromotionById(id: string): Promise<PromotionDTO | null> {
    return this.promotions.get(id) ?? null;
  }
  async listPromotions(q: ListQuery): Promise<{ items: PromotionDTO[]; count: number }> {
    const items = [...this.promotions.values()].slice(q.offset, q.offset + q.limit);
    return { items, count: this.promotions.size };
  }
  async updatePromotion(id: string, patch: UpdatePromotionInput): Promise<PromotionDTO | null> {
    const cur = this.promotions.get(id);
    if (!cur) return null;
    const next: PromotionDTO = {
      ...cur,
      name: patch.name ?? cur.name,
      code: patch.code !== undefined ? patch.code : cur.code,
      type: patch.type ?? cur.type,
      status: patch.status ?? cur.status,
      is_automatic: patch.isAutomatic ?? cur.is_automatic,
      starts_at: patch.startsAt !== undefined ? patch.startsAt : cur.starts_at,
      ends_at: patch.endsAt !== undefined ? patch.endsAt : cur.ends_at,
      usage_limit: patch.usageLimit !== undefined ? patch.usageLimit : cur.usage_limit,
      metadata: patch.metadata !== undefined ? patch.metadata : cur.metadata,
    };
    this.promotions.set(id, next);
    return next;
  }
  async softDeletePromotion(id: string): Promise<void> {
    this.promotions.delete(id);
  }
  async listActiveCataloguePromotionsWithRules(
    now: Date,
  ): Promise<Array<{ promotion: PromotionDTO; rules: PromotionRuleDTO[] }>> {
    const inWindow = (p: PromotionDTO) => {
      if (p.starts_at && p.starts_at.getTime() > now.getTime()) return false;
      if (p.ends_at && p.ends_at.getTime() < now.getTime()) return false;
      return true;
    };
    return [...this.promotions.values()]
      .filter((p) => p.type === "catalogue" && p.status === "active" && inWindow(p))
      .map((p) => ({
        promotion: p,
        rules: [...this.rules.values()].filter((r) => r.promotion_id === p.id),
      }));
  }
  async listActiveOrderPromotionsWithRules(
    now: Date,
  ): Promise<Array<{ promotion: PromotionDTO; rules: PromotionRuleDTO[] }>> {
    const inWindow = (p: PromotionDTO) => {
      if (p.starts_at && p.starts_at.getTime() > now.getTime()) return false;
      if (p.ends_at && p.ends_at.getTime() < now.getTime()) return false;
      return true;
    };
    return [...this.promotions.values()]
      .filter((p) => p.type === "order" && p.status === "active" && inWindow(p))
      .map((p) => ({
        promotion: p,
        rules: [...this.rules.values()].filter((r) => r.promotion_id === p.id),
      }));
  }

  async insertPromotionRule(input: CreatePromotionRuleInput & { id: string }): Promise<PromotionRuleDTO> {
    const dto: PromotionRuleDTO = {
      id: input.id,
      promotion_id: input.promotionId,
      predicate: input.predicate ?? {},
      reward_type: input.rewardType,
      reward_value: input.rewardValue,
      allocation: input.allocation ?? null,
    };
    this.rules.set(dto.id, dto);
    return dto;
  }
  async findPromotionRuleById(id: string): Promise<PromotionRuleDTO | null> {
    return this.rules.get(id) ?? null;
  }
  async listRulesByPromotion(promotionId: string): Promise<PromotionRuleDTO[]> {
    return [...this.rules.values()].filter((r) => r.promotion_id === promotionId);
  }
  async softDeletePromotionRule(id: string): Promise<void> {
    this.rules.delete(id);
  }

  async insertVoucher(input: CreateVoucherInput & { id: string }): Promise<VoucherDTO> {
    const dto: VoucherDTO = {
      id: input.id,
      name: input.name,
      type: input.type ?? "entire_order",
      usage_limit: input.usageLimit ?? null,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      min_spent: input.minSpent ?? null,
      status: input.status ?? "active",
      is_public: input.isPublic ?? false,
      collect_limit: input.collectLimit ?? 1,
      valid_days: input.validDays ?? null,
      tiers: input.tiers ?? null,
      scope_mode: input.scopeMode ?? "include",
    };
    this.vouchers.set(dto.id, dto);
    return dto;
  }
  async findVoucherById(id: string): Promise<VoucherDTO | null> {
    return this.vouchers.get(id) ?? null;
  }
  async listVouchers(q: ListQuery): Promise<{ items: VoucherDTO[]; count: number }> {
    const items = [...this.vouchers.values()].slice(q.offset, q.offset + q.limit);
    return { items, count: this.vouchers.size };
  }
  async updateVoucher(id: string, patch: UpdateVoucherInput): Promise<VoucherDTO | null> {
    const cur = this.vouchers.get(id);
    if (!cur) return null;
    const next: VoucherDTO = {
      ...cur,
      name: patch.name ?? cur.name,
      type: patch.type ?? cur.type,
      usage_limit: patch.usageLimit !== undefined ? patch.usageLimit : cur.usage_limit,
      starts_at: patch.startsAt !== undefined ? patch.startsAt : cur.starts_at,
      ends_at: patch.endsAt !== undefined ? patch.endsAt : cur.ends_at,
      discount_type: patch.discountType ?? cur.discount_type,
      discount_value: patch.discountValue ?? cur.discount_value,
      min_spent: patch.minSpent !== undefined ? patch.minSpent : cur.min_spent,
      status: patch.status ?? cur.status,
      is_public: patch.isPublic !== undefined ? patch.isPublic : cur.is_public,
      collect_limit: patch.collectLimit !== undefined ? patch.collectLimit : cur.collect_limit,
      valid_days: patch.validDays !== undefined ? patch.validDays : cur.valid_days,
      tiers: patch.tiers !== undefined ? patch.tiers : cur.tiers,
      scope_mode: patch.scopeMode !== undefined ? patch.scopeMode : cur.scope_mode,
    };
    this.vouchers.set(id, next);
    return next;
  }
  async softDeleteVoucher(id: string): Promise<void> {
    this.vouchers.delete(id);
  }

  async insertVoucherCollection(input: {
    id: string;
    voucherId: string;
    customerId: string;
    codeId: string;
  }): Promise<void> {
    this.collections.push({
      ...input,
      status: "unused",
      collectedAt: new Date(),
      usedAt: null,
    });
  }
  async countVoucherCollections(voucherId: string, customerId: string): Promise<number> {
    return this.collections.filter((c) => c.voucherId === voucherId && c.customerId === customerId)
      .length;
  }
  async listVoucherCollectionsByCustomer(customerId: string): Promise<CollectedVoucherDTO[]> {
    return this.collections
      .filter((c) => c.customerId === customerId)
      .map((c) => {
        const voucher = this.vouchers.get(c.voucherId)!;
        const code = this.voucherCodes.get(c.codeId)!;
        return {
          id: c.id,
          voucher_id: c.voucherId,
          code: code.code,
          name: voucher.name,
          type: voucher.type,
          discount_type: voucher.discount_type,
          discount_value: voucher.discount_value,
          min_spent: voucher.min_spent,
          starts_at: voucher.starts_at,
          ends_at: voucher.ends_at,
          status: c.status,
          collected_at: c.collectedAt,
          used_at: c.usedAt,
        };
      });
  }
  async findVoucherCollection(voucherId: string, customerId: string): Promise<{ code: string } | null> {
    const row = this.collections.find((c) => c.voucherId === voucherId && c.customerId === customerId);
    if (!row) return null;
    const code = this.voucherCodes.get(row.codeId);
    return code ? { code: code.code } : null;
  }
  async markCollectionUsedByCode(codeId: string): Promise<void> {
    const row = this.collections.find((c) => c.codeId === codeId && c.status === "unused");
    if (row) {
      row.status = "used";
      row.usedAt = new Date();
    }
  }
  async markCollectionUnusedByCode(codeId: string): Promise<void> {
    const row = this.collections.find((c) => c.codeId === codeId);
    if (row) {
      row.status = "unused";
      row.usedAt = null;
    }
  }

  async insertVoucherCode(input: CreateVoucherCodeInput & { id: string }): Promise<VoucherCodeDTO> {
    const dto: VoucherCodeDTO = {
      id: input.id,
      voucher_id: input.voucherId,
      code: input.code,
      used: 0,
      is_active: input.isActive ?? true,
    };
    this.voucherCodes.set(dto.id, dto);
    return dto;
  }
  async findVoucherCodeById(id: string): Promise<VoucherCodeDTO | null> {
    return this.voucherCodes.get(id) ?? null;
  }
  async findVoucherCodeByCode(code: string): Promise<VoucherCodeDTO | null> {
    return [...this.voucherCodes.values()].find((c) => c.code === code) ?? null;
  }
  // voucher_scope（ADR-064）
  private voucherScopes = new Map<string, { id: string; voucher_id: string; scope_type: "product" | "category"; scope_id: string }[]>();
  async listScopesByVoucherIds(
    voucherIds: string[],
  ): Promise<Record<string, Array<{ id: string; voucher_id: string; scope_type: "product" | "category"; scope_id: string }>>> {
    const out: Record<string, Array<{ id: string; voucher_id: string; scope_type: "product" | "category"; scope_id: string }>> = {};
    for (const id of voucherIds) {
      const rows = this.voucherScopes.get(id) ?? [];
      if (rows.length > 0) out[id] = rows;
    }
    return out;
  }
  async listScopesByVoucherId(voucherId: string) {
    return this.voucherScopes.get(voucherId) ?? [];
  }
  async replaceScopes(voucherId: string, scopes: Array<{ scopeType: "product" | "category"; scopeId: string }>) {
    this.voucherScopes.set(
      voucherId,
      scopes.map((s, i) => ({ id: `vs_${voucherId}_${i}`, voucher_id: voucherId, scope_type: s.scopeType, scope_id: s.scopeId })),
    );
  }
  /** 测试专用：直接塞范围（不必走 replaceScopes）。 */
  seedScopes(voucherId: string, scopes: Array<{ scopeType: "product" | "category"; scopeId: string }>) {
    this.voucherScopes.set(
      voucherId,
      scopes.map((s, i) => ({ id: `vs_${voucherId}_${i}`, voucher_id: voucherId, scope_type: s.scopeType, scope_id: s.scopeId })),
    );
  }

  async findVoucherCodeWithVoucherByCode(
    code: string,
  ): Promise<{ code: VoucherCodeDTO; voucher: VoucherDTO } | null> {
    const vc = [...this.voucherCodes.values()].find((c) => c.code === code);
    if (!vc) return null;
    const voucher = this.vouchers.get(vc.voucher_id);
    if (!voucher) return null;
    return { code: vc, voucher };
  }
  async listCodesByVoucher(voucherId: string): Promise<VoucherCodeDTO[]> {
    return [...this.voucherCodes.values()].filter((c) => c.voucher_id === voucherId);
  }
  async updateVoucherCode(codeId: string, patch: { isActive?: boolean }): Promise<VoucherCodeDTO | null> {
    const cur = this.voucherCodes.get(codeId);
    if (!cur) return null;
    const next: VoucherCodeDTO = { ...cur, is_active: patch.isActive ?? cur.is_active };
    this.voucherCodes.set(codeId, next);
    return next;
  }
  async softDeleteVoucherCode(id: string): Promise<void> {
    this.voucherCodes.delete(id);
  }
  async incrementVoucherCodeUsed(
    codeId: string,
  ): Promise<{ used: number; usageLimit: number | null; exceeded: boolean }> {
    const vc = this.voucherCodes.get(codeId);
    if (!vc) throw voucherCodeNotFound(codeId);
    const voucher = this.vouchers.get(vc.voucher_id);
    const usageLimit = voucher?.usage_limit ?? null;
    if (usageLimit !== null && vc.used >= usageLimit) {
      return { used: vc.used, usageLimit, exceeded: true };
    }
    vc.used += 1;
    return { used: vc.used, usageLimit, exceeded: false };
  }
  async releaseVoucherCodeUsed(codeId: string): Promise<void> {
    const vc = this.voucherCodes.get(codeId);
    if (vc && vc.used > 0) vc.used -= 1;
  }

  async insertGiftCard(input: CreateGiftCardInput & { id: string }): Promise<GiftCardDTO> {
    const dto: GiftCardDTO = {
      id: input.id,
      code: input.code,
      currency: input.currency,
      initial_balance: input.initialBalance,
      current_balance: input.initialBalance,
      is_active: input.isActive ?? true,
      expires_at: input.expiresAt ?? null,
      assigned_to: input.assignedTo ?? null,
    };
    this.giftCards.set(dto.id, dto);
    return dto;
  }
  async findGiftCardById(id: string): Promise<GiftCardDTO | null> {
    return this.giftCards.get(id) ?? null;
  }
  async findGiftCardByCode(code: string): Promise<GiftCardDTO | null> {
    return [...this.giftCards.values()].find((g) => g.code === code) ?? null;
  }
  async listGiftCards(q: ListQuery): Promise<{ items: GiftCardDTO[]; count: number }> {
    const items = [...this.giftCards.values()].slice(q.offset, q.offset + q.limit);
    return { items, count: this.giftCards.size };
  }
  async updateGiftCard(id: string, patch: UpdateGiftCardInput): Promise<GiftCardDTO | null> {
    const cur = this.giftCards.get(id);
    if (!cur) return null;
    const next: GiftCardDTO = {
      ...cur,
      code: patch.code ?? cur.code,
      currency: patch.currency ?? cur.currency,
      initial_balance: patch.initialBalance ?? cur.initial_balance,
      is_active: patch.isActive ?? cur.is_active,
      expires_at: patch.expiresAt !== undefined ? patch.expiresAt : cur.expires_at,
      assigned_to: patch.assignedTo !== undefined ? patch.assignedTo : cur.assigned_to,
    };
    this.giftCards.set(id, next);
    return next;
  }
  async softDeleteGiftCard(id: string): Promise<void> {
    this.giftCards.delete(id);
  }

  async deductGiftCardBalance(
    cardId: string,
    amountMinor: bigint,
  ): Promise<{ balance: bigint; insufficient: boolean }> {
    const card = this.giftCards.get(cardId);
    if (!card) throw giftCardNotFound(cardId);
    if (card.current_balance < amountMinor) {
      return { balance: card.current_balance, insufficient: true };
    }
    card.current_balance -= amountMinor;
    return { balance: card.current_balance, insufficient: false };
  }
  async refundGiftCardBalance(cardId: string, amountMinor: bigint): Promise<void> {
    const card = this.giftCards.get(cardId);
    if (!card) return;
    card.current_balance += amountMinor;
  }

  async insertGiftCardEvent(input: {
    id: string;
    giftCardId: string;
    type: GiftCardEventType;
    amount: bigint;
    orderId?: string | null;
    parameters?: Record<string, unknown> | null;
  }): Promise<GiftCardEventDTO> {
    const dto: GiftCardEventDTO = {
      id: input.id,
      gift_card_id: input.giftCardId,
      type: input.type,
      amount: input.amount,
      order_id: input.orderId ?? null,
      parameters: input.parameters ?? null,
      created_at: new Date(),
    };
    const list = this.giftCardEvents.get(input.giftCardId) ?? [];
    list.push(dto);
    this.giftCardEvents.set(input.giftCardId, list);
    return dto;
  }
  async listEventsByGiftCard(giftCardId: string): Promise<GiftCardEventDTO[]> {
    return this.giftCardEvents.get(giftCardId) ?? [];
  }

  // —— points（ADR-093）——
  private pointBalances = new Map<string, bigint>();
  private pointLedger: PointLedgerDTO[] = [];

  async getPointBalance(customerId: string): Promise<bigint> {
    return this.pointBalances.get(customerId) ?? 0n;
  }
  async applyPointDelta(input: {
    id: string;
    customerId: string;
    kind: PointLedgerKind;
    delta: bigint;
    orderId?: string | null;
  }): Promise<{ balance_after: bigint }> {
    // 幂等：earn 同订单只记一次（与真实 unique index 同语义）
    if (input.kind === "earn" && input.orderId && this.pointLedger.some((l) => l.kind === "earn" && l.order_id === input.orderId)) {
      return { balance_after: this.pointBalances.get(input.customerId) ?? 0n };
    }
    const before = this.pointBalances.get(input.customerId) ?? 0n;
    const after = before + input.delta;
    if (after < 0n) throw new Error("积分余额不足");
    this.pointBalances.set(input.customerId, after);
    this.pointLedger.push({
      id: input.id,
      customer_id: input.customerId,
      kind: input.kind,
      delta: input.delta,
      balance_after: after,
      order_id: input.orderId ?? null,
      created_at: new Date().toISOString(),
    });
    return { balance_after: after };
  }
  async listPointLedger(
    customerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: PointLedgerDTO[]; count: number }> {
    const all = this.pointLedger.filter((l) => l.customer_id === customerId);
    return { items: all.slice(offset, offset + limit), count: all.length };
  }
}

describe("PromotionService（M-promotion，阶段 1 CRUD 骨架）", () => {
  it("promotion 创建/查询/更新/软删除闭环", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);

    const created = await service.createPromotion({ name: "全场 8 折", type: "order", isAutomatic: true });
    expect(created.id.startsWith("promo_")).toBe(true);
    expect(created.status).toBe("draft");

    const retrieved = await service.retrievePromotion(created.id);
    expect(retrieved.name).toBe("全场 8 折");

    const updated = await service.updatePromotion(created.id, { status: "active" });
    expect(updated.status).toBe("active");

    await service.deletePromotion(created.id);
    await expect(service.retrievePromotion(created.id)).rejects.toThrow(/Promotion not found/);
  });

  it("promotion 规则挂接与列出", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);

    const promo = await service.createPromotion({ name: "分类促销", type: "catalogue" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { categoryIds: ["cat_1"] },
      rewardType: "percentage",
      rewardValue: 2000n,
      allocation: "each",
    });

    const rules = await service.listPromotionRules(promo.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.reward_value).toBe(2000n);
    expect(rules[0]?.predicate).toEqual({ categoryIds: ["cat_1"] });
  });

  it("voucher + voucher_code 创建与列出", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);

    const voucher = await service.createVoucher({
      name: "满 100 减 20",
      discountType: "fixed",
      discountValue: 2000n,
      minSpent: 10000n,
    });
    expect(voucher.id.startsWith("vouch_")).toBe(true);

    const code = await service.addVoucherCode({ voucherId: voucher.id, code: "SAVE20" });
    expect(code.id.startsWith("vcode_")).toBe(true);

    const codes = await service.listVoucherCodes(voucher.id);
    expect(codes).toHaveLength(1);
    expect(codes[0]?.code).toBe("SAVE20");
  });

  it("gift_card 创建/按码查询/流水列出", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);

    const card = await service.createGiftCard({
      code: "GC-XXXX-0001",
      currency: "CNY",
      initialBalance: 50000n,
      assignedTo: "cust_1",
    });
    expect(card.id.startsWith("gcard_")).toBe(true);
    expect(card.current_balance).toBe(50000n);

    const byCode = await service.retrieveGiftCardByCode("GC-XXXX-0001");
    expect(byCode.id).toBe(card.id);

    // createGiftCard 自动写 issued 流水（初始余额入账，硬约束 6）。
    const events = await service.listGiftCardEvents(card.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("issued");
    expect(events[0]?.amount).toBe(50000n);
  });

  it("computeDiscounts：目录促销 fixed 折扣 = reward_value × quantity", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promo = await service.createPromotion({ name: "指定变体减 20", type: "catalogue" });
    await service.updatePromotion(promo.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { variantIds: ["var_1"] },
      rewardType: "fixed",
      rewardValue: 2000n,
      allocation: "each",
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 3, unitPriceMinor: 9900n }],
      subtotalMinor: 29700n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    expect(res.lineAdjustments).toEqual([
      { itemId: "cli_1", amountMinor: 6000n, promotionId: promo.id, code: "" },
    ]);
    expect(res.orderDiscountMinor).toBe(0n);
    expect(res.voucherDiscountMinor).toBe(0n);
    expect(res.giftCardAppliedMinor).toBe(0n);
  });

  it("功能开关：关闭后即使促销 active 也不命中；未落库时默认关闭", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promo = await service.createPromotion({ name: "满 100 减 10", type: "order" });
    await service.updatePromotion(promo.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { subtotalGte: 10000 },
      rewardType: "fixed",
      rewardValue: 1000n,
      allocation: null,
    });
    const ctx = {
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 3, unitPriceMinor: 9900n }],
      subtotalMinor: 29700n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    };

    expect((await service.computeDiscounts(ctx)).orderDiscountMinor).toBe(1000n);

    await service.setFeatureEnabled("promotion", false);
    const off = await service.computeDiscounts(ctx);
    expect(off.orderDiscountMinor).toBe(0n);
    expect(off.orderDiscounts).toHaveLength(0);

    // 表里没有记录时按关闭处理（默认全关）
    repo.featureFlags.clear();
    expect(await service.getFeatureFlags()).toEqual({
      promotion: false,
      voucher: false,
      gift_card: false,
      points: false,
    });
  });

  it("computeDiscounts：percentage 折扣 = round(单价×数量×bps/10000)", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promo = await service.createPromotion({ name: "分类 8 折", type: "catalogue" });
    await service.updatePromotion(promo.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { categoryIds: ["cat_1"] },
      rewardType: "percentage",
      rewardValue: 2000n, // 20%
      allocation: "each",
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [
        { id: "cli_1", variantId: "var_1", categoryIds: ["cat_1"], quantity: 2, unitPriceMinor: 9900n },
        { id: "cli_2", variantId: "var_2", categoryIds: ["cat_2"], quantity: 1, unitPriceMinor: 9900n },
      ],
      subtotalMinor: 29700n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    // 9900 × 2 × 2000 / 10000 = 3960
    expect(res.lineAdjustments).toEqual([
      { itemId: "cli_1", amountMinor: 3960n, promotionId: promo.id, code: "" },
    ]);
  });

  it("computeDiscounts：多规则命中取折扣最大的一条（Saleor）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promoA = await service.createPromotion({ name: "减 10", type: "catalogue" });
    await service.updatePromotion(promoA.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promoA.id,
      predicate: { variantIds: ["var_1"] },
      rewardType: "fixed",
      rewardValue: 1000n,
    });
    const promoB = await service.createPromotion({ name: "减 30", type: "catalogue" });
    await service.updatePromotion(promoB.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promoB.id,
      predicate: { categoryIds: ["cat_1"] },
      rewardType: "fixed",
      rewardValue: 3000n,
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: ["cat_1"], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    expect(res.lineAdjustments).toHaveLength(1);
    expect(res.lineAdjustments[0]?.amountMinor).toBe(3000n);
    expect(res.lineAdjustments[0]?.promotionId).toBe(promoB.id);
  });

  it("computeDiscounts：折扣封顶到行项小计（不超过应付）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promo = await service.createPromotion({ name: "超额百分比", type: "catalogue" });
    await service.updatePromotion(promo.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { variantIds: ["var_1"] },
      rewardType: "percentage",
      rewardValue: 20000n, // 200%，超出小计
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    expect(res.lineAdjustments[0]?.amountMinor).toBe(9900n);
  });

  it("computeDiscounts：draft/inactive/过期促销不命中", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const draft = await service.createPromotion({ name: "草稿", type: "catalogue" });
    await service.addPromotionRule({
      promotionId: draft.id,
      predicate: { variantIds: ["var_1"] },
      rewardType: "fixed",
      rewardValue: 1000n,
    });
    const expired = await service.createPromotion({ name: "过期", type: "catalogue", endsAt: new Date("2020-01-01") });
    await service.updatePromotion(expired.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: expired.id,
      predicate: { variantIds: ["var_1"] },
      rewardType: "fixed",
      rewardValue: 1000n,
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    expect(res.lineAdjustments).toHaveLength(0);
  });

  it("computeDiscounts：订单促销 fixed 满减命中返回 orderDiscountMinor + 明细", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promo = await service.createPromotion({ name: "满 100 减 20", type: "order", code: "ORDER20" });
    await service.updatePromotion(promo.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { subtotalGte: 10000 },
      rewardType: "fixed",
      rewardValue: 2000n,
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 2, unitPriceMinor: 9900n }],
      subtotalMinor: 19800n,
      shippingMinor: 800n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    expect(res.orderDiscountMinor).toBe(2000n);
    expect(res.orderDiscounts).toEqual([{ promotionId: promo.id, code: "ORDER20", amountMinor: 2000n }]);
    expect(res.lineAdjustments).toHaveLength(0);
  });

  it("computeDiscounts：订单促销 percentage 折扣 = round(小计×bps/10000)", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promo = await service.createPromotion({ name: "全场 8 折", type: "order" });
    await service.updatePromotion(promo.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { currencyEq: "CNY" },
      rewardType: "percentage",
      rewardValue: 2000n, // 20% 折扣
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 2, unitPriceMinor: 9900n }],
      subtotalMinor: 19800n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    // 19800 × 2000 / 10000 = 3960
    expect(res.orderDiscountMinor).toBe(3960n);
    expect(res.orderDiscounts[0]?.amountMinor).toBe(3960n);
  });

  it("computeDiscounts：订单促销未达 subtotalGte 门槛不命中", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promo = await service.createPromotion({ name: "满 200 减 50", type: "order" });
    await service.updatePromotion(promo.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { subtotalGte: 20000 },
      rewardType: "fixed",
      rewardValue: 5000n,
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    expect(res.orderDiscountMinor).toBe(0n);
    expect(res.orderDiscounts).toHaveLength(0);
  });

  it("computeDiscounts：多条订单促销命中取折扣最大的一条", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promoA = await service.createPromotion({ name: "减 10", type: "order" });
    await service.updatePromotion(promoA.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promoA.id,
      predicate: { subtotalGte: 1000 },
      rewardType: "fixed",
      rewardValue: 1000n,
    });
    const promoB = await service.createPromotion({ name: "减 30", type: "order" });
    await service.updatePromotion(promoB.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promoB.id,
      predicate: { subtotalGte: 1000 },
      rewardType: "fixed",
      rewardValue: 3000n,
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    expect(res.orderDiscountMinor).toBe(3000n);
    expect(res.orderDiscounts).toEqual([{ promotionId: promoB.id, code: null, amountMinor: 3000n }]);
  });

  it("computeDiscounts：订单促销折扣封顶到小计（不超应付）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const promo = await service.createPromotion({ name: "超额固定", type: "order" });
    await service.updatePromotion(promo.id, { status: "active" });
    await service.addPromotionRule({
      promotionId: promo.id,
      predicate: { subtotalGte: 1000 },
      rewardType: "fixed",
      rewardValue: 999999n,
    });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: [],
    });
    expect(res.orderDiscountMinor).toBe(9900n);
  });

  it("查询不存在的资源抛领域错误", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await expect(service.retrieveVoucher("vouch_missing")).rejects.toThrow(/Voucher not found/);
    await expect(service.retrieveGiftCard("gcard_missing")).rejects.toThrow(/Gift card not found/);
  });

  // —— 阶段 4：Voucher ——

  it("computeDiscounts：voucher fixed 命中返回 voucherDiscountMinor + 明细", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({
      name: "满 100 减 20",
      discountType: "fixed",
      discountValue: 2000n,
      minSpent: 10000n,
    });
    await service.addVoucherCode({ voucherId: voucher.id, code: "SAVE20" });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 2, unitPriceMinor: 9900n }],
      subtotalMinor: 19800n,
      shippingMinor: 800n,
      voucherCodes: ["SAVE20"],
      giftCardCodes: [],
    });
    expect(res.voucherDiscountMinor).toBe(2000n);
    expect(res.voucherDiscounts).toEqual([{ promotionId: voucher.id, code: "SAVE20", amountMinor: 2000n }]);
  });

  it("computeDiscounts：阶梯满减取满足门槛的最高档（ADR-086）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({
      name: "阶梯券",
      discountType: "fixed",
      discountValue: 0n,
      tiers: [
        { min_spent_minor: 19900, discount_minor: 2000 },
        { min_spent_minor: 29900, discount_minor: 4000 },
      ],
    });
    await service.addVoucherCode({ voucherId: voucher.id, code: "TIER" });

    const cart = (subtotalMinor: bigint) =>
      service.computeDiscounts({
        currencyCode: "CNY",
        items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: subtotalMinor }],
        subtotalMinor,
        shippingMinor: 0n,
        voucherCodes: ["TIER"],
        giftCardCodes: [],
      });

    // 199 满足第一档；250 仍是第一档；300 进第二档；150 一档都不满足 → 0
    expect((await cart(19900n)).voucherDiscountMinor).toBe(2000n);
    expect((await cart(25000n)).voucherDiscountMinor).toBe(2000n);
    expect((await cart(30000n)).voucherDiscountMinor).toBe(4000n);
    expect((await cart(15000n)).voucherDiscountMinor).toBe(0n);
  });

  it("computeDiscounts：voucher percentage = round(小计×bps/10000)", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({
      name: "8 折券",
      discountType: "percentage",
      discountValue: 2000n, // 20% 折扣
    });
    await service.addVoucherCode({ voucherId: voucher.id, code: "P20" });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 2, unitPriceMinor: 9900n }],
      subtotalMinor: 19800n,
      shippingMinor: 0n,
      voucherCodes: ["P20"],
      giftCardCodes: [],
    });
    // 19800 × 2000 / 10000 = 3960
    expect(res.voucherDiscountMinor).toBe(3960n);
  });

  it("computeDiscounts：min_spent 未达标不命中", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({
      name: "满 200 减 50",
      discountType: "fixed",
      discountValue: 5000n,
      minSpent: 20000n,
    });
    await service.addVoucherCode({ voucherId: voucher.id, code: "BIG50" });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: ["BIG50"],
      giftCardCodes: [],
    });
    expect(res.voucherDiscountMinor).toBe(0n);
    expect(res.voucherDiscounts).toHaveLength(0);
  });

  it("computeDiscounts：停用/过期/券码停用/超限 均不命中（即时生效）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);

    const disabled = await service.createVoucher({ name: "已停用", discountType: "fixed", discountValue: 1000n });
    await service.updateVoucher(disabled.id, { status: "disabled" });
    await service.addVoucherCode({ voucherId: disabled.id, code: "OFF" });

    const expired = await service.createVoucher({
      name: "已过期",
      discountType: "fixed",
      discountValue: 1000n,
      endsAt: new Date("2020-01-01"),
    });
    await service.addVoucherCode({ voucherId: expired.id, code: "OLD" });

    const inactiveCode = await service.createVoucher({ name: "码停用", discountType: "fixed", discountValue: 1000n });
    await service.addVoucherCode({ voucherId: inactiveCode.id, code: "SLEEP", isActive: false });

    const limited = await service.createVoucher({ name: "限 1 次", discountType: "fixed", discountValue: 1000n, usageLimit: 1 });
    const limitedCode = await service.addVoucherCode({ voucherId: limited.id, code: "ONCE" });
    await repo.incrementVoucherCodeUsed(limitedCode.id);

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: ["OFF", "OLD", "SLEEP", "ONCE"],
      giftCardCodes: [],
    });
    expect(res.voucherDiscountMinor).toBe(0n);
  });

  it("computeDiscounts：多码命中取折扣最大的一条（与其他促销一致）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const a = await service.createVoucher({ name: "减 10", discountType: "fixed", discountValue: 1000n });
    await service.addVoucherCode({ voucherId: a.id, code: "A10" });
    const b = await service.createVoucher({ name: "减 30", discountType: "fixed", discountValue: 3000n });
    await service.addVoucherCode({ voucherId: b.id, code: "B30" });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: ["A10", "B30"],
      giftCardCodes: [],
    });
    expect(res.voucherDiscountMinor).toBe(3000n);
    expect(res.voucherDiscounts).toEqual([{ promotionId: b.id, code: "B30", amountMinor: 3000n }]);
  });

  it("computeDiscounts：voucher 折扣封顶到小计（不超应付）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({ name: "超额券", discountType: "fixed", discountValue: 999999n });
    await service.addVoucherCode({ voucherId: voucher.id, code: "BIG" });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: ["BIG"],
      giftCardCodes: [],
    });
    expect(res.voucherDiscountMinor).toBe(9900n);
  });

  it("consumeVoucherCodes：原子自增 used，超限抛 voucherUsageLimitReached 且不自增", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({ name: "限 1 次", discountType: "fixed", discountValue: 1000n, usageLimit: 1 });
    await service.addVoucherCode({ voucherId: voucher.id, code: "ONCE" });

    await service.consumeVoucherCodes(["ONCE"]);
    const codes = await service.listVoucherCodes(voucher.id);
    expect(codes[0]?.used).toBe(1);

    await expect(service.consumeVoucherCodes(["ONCE"])).rejects.toThrow(/usage limit reached/);
    expect((await service.listVoucherCodes(voucher.id))[0]?.used).toBe(1);
  });

  it("releaseVoucherCodes：回退 used（补偿幂等，下限 0）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({ name: "补偿券", discountType: "fixed", discountValue: 1000n });
    await service.addVoucherCode({ voucherId: voucher.id, code: "RB" });

    await service.consumeVoucherCodes(["RB"]);
    await service.releaseVoucherCodes(["RB"]);
    expect((await service.listVoucherCodes(voucher.id))[0]?.used).toBe(0);

    // 二次释放不再变负
    await service.releaseVoucherCodes(["RB"]);
    expect((await service.listVoucherCodes(voucher.id))[0]?.used).toBe(0);
  });

  it("retrieveVoucherCodeByCode / updateVoucherCode 启停券码", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({ name: "码启停", discountType: "fixed", discountValue: 1000n });
    await service.addVoucherCode({ voucherId: voucher.id, code: "TOGGLE" });

    const found = await service.retrieveVoucherCodeByCode("TOGGLE");
    expect(found?.code).toBe("TOGGLE");

    const disabled = await service.updateVoucherCode(found!.id, { isActive: false });
    expect(disabled.is_active).toBe(false);
  });

  // —— 阶段 5：Gift Card ——

  it("computeDiscounts：gift card 抵扣不超过剩余应付（封顶，不为负）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await service.createGiftCard({
      code: "GC-100",
      currency: "CNY",
      initialBalance: 50000n,
    });

    // 小计 19800 + 运费 800 = 20600，卡余额 50000 → 只抵 20600
    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 2, unitPriceMinor: 9900n }],
      subtotalMinor: 19800n,
      shippingMinor: 800n,
      voucherCodes: [],
      giftCardCodes: ["GC-100"],
    });
    expect(res.giftCardAppliedMinor).toBe(20600n);
    expect(res.giftCardDiscounts).toEqual([
      { giftCardId: expect.any(String), code: "GC-100", amountMinor: 20600n },
    ]);
  });

  it("computeDiscounts：多卡按顺序累加，直到剩余应付为 0", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await service.createGiftCard({ code: "GC-A", currency: "CNY", initialBalance: 5000n });
    await service.createGiftCard({ code: "GC-B", currency: "CNY", initialBalance: 20000n });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 2, unitPriceMinor: 9900n }],
      subtotalMinor: 19800n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: ["GC-A", "GC-B"],
    });
    // 第一张抵 5000，第二张抵剩余 14800
    expect(res.giftCardAppliedMinor).toBe(19800n);
    expect(res.giftCardDiscounts).toHaveLength(2);
    expect(res.giftCardDiscounts[0]?.amountMinor).toBe(5000n);
    expect(res.giftCardDiscounts[1]?.amountMinor).toBe(14800n);
  });

  it("computeDiscounts：停用/过期/币种不匹配/assigned_to 不匹配 均不命中", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const inactive = await service.createGiftCard({ code: "GC-OFF", currency: "CNY", initialBalance: 10000n });
    await service.setGiftCardActive(inactive.id, false);
    await service.createGiftCard({
      code: "GC-OLD",
      currency: "CNY",
      initialBalance: 10000n,
      expiresAt: new Date("2020-01-01"),
    });
    await service.createGiftCard({ code: "GC-USD", currency: "USD", initialBalance: 10000n });
    await service.createGiftCard({ code: "GC-BOUND", currency: "CNY", initialBalance: 10000n, assignedTo: "cust_x" });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      customerId: "cust_1",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: ["GC-OFF", "GC-OLD", "GC-USD", "GC-BOUND"],
    });
    expect(res.giftCardAppliedMinor).toBe(0n);
    expect(res.giftCardDiscounts).toHaveLength(0);
  });

  it("computeDiscounts：assigned_to 匹配当前客户时命中（防套现）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await service.createGiftCard({ code: "GC-MINE", currency: "CNY", initialBalance: 10000n, assignedTo: "cust_1" });

    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      customerId: "cust_1",
      items: [{ id: "cli_1", variantId: "var_1", categoryIds: [], quantity: 1, unitPriceMinor: 9900n }],
      subtotalMinor: 9900n,
      shippingMinor: 0n,
      voucherCodes: [],
      giftCardCodes: ["GC-MINE"],
    });
    expect(res.giftCardAppliedMinor).toBe(9900n);
  });

  it("consumeGiftCards：原子扣减余额 + 写 used_in_order 流水；余额不足抛错且不扣", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const card = await service.createGiftCard({ code: "GC-DED", currency: "CNY", initialBalance: 30000n });

    await service.consumeGiftCards([{ code: "GC-DED", amountMinor: 12000n }], "ord_1");
    const after = await service.retrieveGiftCardByCode("GC-DED");
    expect(after.current_balance).toBe(18000n);
    const events = await service.listGiftCardEvents(card.id);
    expect(events.some((e) => e.type === "used_in_order" && e.amount === -12000n && e.order_id === "ord_1")).toBe(true);

    // 余额不足：抛 giftCardInsufficientBalance，余额不变
    await expect(
      service.consumeGiftCards([{ code: "GC-DED", amountMinor: 999999n }], "ord_2"),
    ).rejects.toThrow(/insufficient balance/);
    expect((await service.retrieveGiftCardByCode("GC-DED")).current_balance).toBe(18000n);
  });

  it("releaseGiftCards：补偿加回余额 + 写 refunded_in_order 流水", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const card = await service.createGiftCard({ code: "GC-REF", currency: "CNY", initialBalance: 30000n });

    await service.consumeGiftCards([{ code: "GC-REF", amountMinor: 12000n }], "ord_1");
    await service.releaseGiftCards([{ code: "GC-REF", amountMinor: 12000n }], "ord_1");
    expect((await service.retrieveGiftCardByCode("GC-REF")).current_balance).toBe(30000n);
    const events = await service.listGiftCardEvents(card.id);
    expect(events.some((e) => e.type === "refunded_in_order" && e.amount === 12000n)).toBe(true);
  });

  it("adjustGiftCardBalance：手动调账写 balance_adjusted 流水（加/减）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const card = await service.createGiftCard({ code: "GC-ADJ", currency: "CNY", initialBalance: 10000n });

    await service.adjustGiftCardBalance(card.id, 5000n, { reason: "补偿" });
    expect((await service.retrieveGiftCard(card.id)).current_balance).toBe(15000n);

    await service.adjustGiftCardBalance(card.id, -3000n, { reason: "人工扣减" });
    expect((await service.retrieveGiftCard(card.id)).current_balance).toBe(12000n);

    const events = await service.listGiftCardEvents(card.id);
    expect(events.filter((e) => e.type === "balance_adjusted")).toHaveLength(2);
  });

  it("setGiftCardActive：启停写 activated/deactivated 流水", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const card = await service.createGiftCard({ code: "GC-TOG", currency: "CNY", initialBalance: 10000n });

    await service.setGiftCardActive(card.id, false);
    expect((await service.retrieveGiftCard(card.id)).is_active).toBe(false);
    await service.setGiftCardActive(card.id, true);
    expect((await service.retrieveGiftCard(card.id)).is_active).toBe(true);

    const events = await service.listGiftCardEvents(card.id);
    expect(events.some((e) => e.type === "deactivated")).toBe(true);
    expect(events.some((e) => e.type === "activated")).toBe(true);
  });
});

describe("优惠券适用范围（ADR-064）", () => {
  /** 两行购物车：行 A 是「指定商品」，行 B 是别的商品（不在范围里）。 */
  function twoLineCtx(over: Partial<Record<string, unknown>> = {}) {
    return {
      currencyCode: "CNY",
      items: [
        { id: "cli_1", variantId: "var_1", productId: "prod_a", categoryIds: ["cat_x"], quantity: 1, unitPriceMinor: 9900n },
        { id: "cli_2", variantId: "var_2", productId: "prod_b", categoryIds: ["cat_y"], quantity: 2, unitPriceMinor: 5000n },
      ],
      subtotalMinor: 19900n,
      shippingMinor: 0n,
      voucherCodes: ["CODE"],
      giftCardCodes: [],
      ...over,
    };
  }

  it("指定商品券只对命中商品算钱：固定减免封顶到那部分小计", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const v = await service.createVoucher({
      name: "A 商品专享减 200",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 20000n, // 远超 A 的小计 9900
      scopes: [{ scopeType: "product", scopeId: "prod_a" }],
    });
    await service.addVoucherCode({ voucherId: v.id, code: "CODE" });

    const res = await service.computeDiscounts(twoLineCtx() as never);
    // A 的小计是 9900，折扣 20000 被压到 9900；B 完全不算
    expect(res.voucherDiscountMinor).toBe(9900n);
  });

  it("指定分类券命中分类内的行", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const v = await service.createVoucher({
      name: "cat_x 分类 8 折",
      type: "specific_product",
      discountType: "percentage",
      discountValue: 2000n,
      scopes: [{ scopeType: "category", scopeId: "cat_x" }],
    });
    await service.addVoucherCode({ voucherId: v.id, code: "CODE" });

    const res = await service.computeDiscounts(twoLineCtx() as never);
    // 只有 A（9900）参与：9900 × 2000/10000 = 1980
    expect(res.voucherDiscountMinor).toBe(1980n);
  });

  it("满减门槛按适用小计算：整单够、适用部分不够 → 不命中", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const v = await service.createVoucher({
      name: "A 商品满 150 减 30",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 3000n,
      minSpent: 15000n, // A 只有 9900，不够；整单 19900 够
      scopes: [{ scopeType: "product", scopeId: "prod_a" }],
    });
    await service.addVoucherCode({ voucherId: v.id, code: "CODE" });

    const res = await service.computeDiscounts(twoLineCtx() as never);
    expect(res.voucherDiscountMinor).toBe(0n);
  });

  it("车里没有一件适用商品 → 不命中（不静默降级成整单）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const v = await service.createVoucher({
      name: "不存在的商品专享",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 1000n,
      scopes: [{ scopeType: "product", scopeId: "prod_none" }],
    });
    await service.addVoucherCode({ voucherId: v.id, code: "CODE" });

    const res = await service.computeDiscounts(twoLineCtx() as never);
    expect(res.voucherDiscountMinor).toBe(0n);
  });

  it("type 是 specific_product 但没配范围 → 永远用不了（不退回整单）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const v = await service.createVoucher({
      name: "忘了配范围",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 1000n,
      scopes: [],
    });
    await service.addVoucherCode({ voucherId: v.id, code: "CODE" });

    const res = await service.computeDiscounts(twoLineCtx() as never);
    expect(res.voucherDiscountMinor).toBe(0n);
  });

  it("运费券：只抵运费，无运费时用不了；抵扣封顶到运费", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const v = await service.createVoucher({
      name: "免运费券",
      type: "shipping",
      discountType: "fixed",
      discountValue: 100000n, // 想全免
    });
    await service.addVoucherCode({ voucherId: v.id, code: "CODE" });

    // 没有运费：用不了
    const noShip = await service.computeDiscounts(twoLineCtx({ shippingMinor: 0n }) as never);
    expect(noShip.voucherDiscountMinor).toBe(0n);

    // 有 800 分运费：封顶到 800
    const withShip = await service.computeDiscounts(twoLineCtx({ shippingMinor: 800n }) as never);
    expect(withShip.voucherDiscountMinor).toBe(800n);
  });

  it("公开券与我的卡券都带出范围，供店面提示（ADR-066）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const v = await service.createVoucher({
      name: "范围券",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 1000n,
      isPublic: true,
      scopes: [
        { scopeType: "product", scopeId: "prod_a" },
        { scopeType: "category", scopeId: "cat_x" },
      ],
    });
    await service.addVoucherCode({ voucherId: v.id, code: "CODE" });

    const pubs = await service.listPublicVouchers(null);
    const pub = pubs.find((x) => x.id === v.id);
    expect(pub?.scopes).toEqual([
      { scope_type: "product", scope_id: "prod_a" },
      { scope_type: "category", scope_id: "cat_x" },
    ]);

    // 领取后，我的卡券也带范围
    await service.collectVoucher(v.id, "cust_1");
    const mine = await service.listCollectedVouchers("cust_1");
    expect(mine[0]?.scopes).toEqual([
      { scope_type: "product", scope_id: "prod_a" },
      { scope_type: "category", scope_id: "cat_x" },
    ]);
  });
});

describe("领券（ADR-029）", () => {
  /** 建一张公开可领的券。 */
  async function setupPublicVoucher(over: Partial<CreateVoucherInput> = {}) {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await service.setFeatureEnabled("voucher", true);
    const voucher = await service.createVoucher({
      name: "满 199 减 20",
      discountType: "fixed",
      discountValue: 2000n,
      minSpent: 19900n,
      isPublic: true,
      collectLimit: 1,
      ...over,
    });
    return { repo, service, voucher };
  }

  it("领取：生成专属券码并记账，重复领取返回原码（幂等）", async () => {
    const { service, voucher } = await setupPublicVoucher();

    const first = await service.collectVoucher(voucher.id, "cust_1");
    expect(first.code).toMatch(/^[A-Z2-9]{10}$/);
    expect(first.alreadyCollected).toBe(false);

    const again = await service.collectVoucher(voucher.id, "cust_1");
    expect(again.code).toBe(first.code);
    expect(again.alreadyCollected).toBe(true);
  });

  it("每人限领 2 张：能领两次，第三张拿回已有的码", async () => {
    const { service, voucher } = await setupPublicVoucher({ collectLimit: 2 });

    const a = await service.collectVoucher(voucher.id, "cust_1");
    const b = await service.collectVoucher(voucher.id, "cust_1");
    expect(b.code).not.toBe(a.code); // 第二张是新码
    expect(b.alreadyCollected).toBe(false);

    const c = await service.collectVoucher(voucher.id, "cust_1");
    expect(c.alreadyCollected).toBe(true);
    expect([a.code, b.code]).toContain(c.code);
  });

  it("未公开的券不能领", async () => {
    const { service } = await setupPublicVoucher({ isPublic: false });
    const { service: s2, voucher } = await setupPublicVoucher({ isPublic: false });
    void service;
    await expect(s2.collectVoucher(voucher.id, "cust_1")).rejects.toThrow();
  });

  it("店面只列公开 + 启用 + 在有效期内的券", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await service.setFeatureEnabled("voucher", true);
    await service.createVoucher({
      name: "公开券",
      discountType: "fixed",
      discountValue: 1000n,
      isPublic: true,
    });
    await service.createVoucher({
      name: "内部券",
      discountType: "fixed",
      discountValue: 1000n,
      isPublic: false,
    });
    await service.createVoucher({
      name: "过期券",
      discountType: "fixed",
      discountValue: 1000n,
      isPublic: true,
      endsAt: new Date(Date.now() - 3600_000),
    });

    const list = await service.listPublicVouchers();
    expect(list.map((v) => v.name)).toEqual(["公开券"]);
    expect(list[0]!.collected).toBe(false);
  });

  it("已领的券在店面列表里带 collected 标记", async () => {
    const { service, voucher } = await setupPublicVoucher();
    await service.collectVoucher(voucher.id, "cust_1");

    const mine = await service.listPublicVouchers("cust_1");
    expect(mine[0]!.collected).toBe(true);
    expect(mine[0]!.collected_count).toBe(1);

    const guest = await service.listPublicVouchers(null);
    expect(guest[0]!.collected).toBe(false);
  });

  it("核销把领取记录标为已用，补偿退回未用", async () => {
    const { service, voucher } = await setupPublicVoucher();
    const { code } = await service.collectVoucher(voucher.id, "cust_1");

    await service.consumeVoucherCodes([code]);
    let mine = await service.listCollectedVouchers("cust_1");
    expect(mine[0]!.status).toBe("used");
    expect(mine[0]!.used_at).toBeTruthy();

    await service.releaseVoucherCodes([code]);
    mine = await service.listCollectedVouchers("cust_1");
    expect(mine[0]!.status).toBe("unused");
  });

  it("我的卡券：未用排在前面", async () => {
    const { service, voucher } = await setupPublicVoucher({ collectLimit: 2 });
    const a = await service.collectVoucher(voucher.id, "cust_1");
    await service.collectVoucher(voucher.id, "cust_1");
    await service.consumeVoucherCodes([a.code]);

    const mine = await service.listCollectedVouchers("cust_1");
    expect(mine).toHaveLength(2);
    expect(mine[0]!.status).toBe("unused");
    expect(mine[1]!.status).toBe("used");
  });
});

describe("本商品可用券（ADR-071）", () => {
  it("整单券/运费券都算可用；指定商品券只认命中本商品或本分类的", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await service.setFeatureEnabled("voucher", true);

    const order = await service.createVoucher({
      name: "整单券",
      discountType: "fixed",
      discountValue: 1000n,
      isPublic: true,
    });
    const shipping = await service.createVoucher({
      name: "运费券",
      type: "shipping",
      discountType: "fixed",
      discountValue: 800n,
      isPublic: true,
    });
    const hitProduct = await service.createVoucher({
      name: "限本商品",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 500n,
      isPublic: true,
      scopes: [{ scopeType: "product", scopeId: "prod_a" }],
    });
    const hitCategory = await service.createVoucher({
      name: "限本分类",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 300n,
      isPublic: true,
      scopes: [{ scopeType: "category", scopeId: "cat_x" }],
    });
    await service.createVoucher({
      name: "限别的商品",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 200n,
      isPublic: true,
      scopes: [{ scopeType: "product", scopeId: "prod_b" }],
    });
    await service.createVoucher({
      name: "非公开券",
      discountType: "fixed",
      discountValue: 100n,
      isPublic: false,
    });

    const list = await service.listPublicVouchersForProduct({
      productId: "prod_a",
      categoryIds: ["cat_x"],
    });
    expect(list.map((v) => v.id).sort()).toEqual(
      [order.id, shipping.id, hitProduct.id, hitCategory.id].sort(),
    );
  });

  it("空范围的指定商品券不出现（结账时它也用不了，不能在这里骗人领）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await service.setFeatureEnabled("voucher", true);
    const broken = await service.createVoucher({
      name: "没范围的指定商品券",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 500n,
      isPublic: true,
    });

    const list = await service.listPublicVouchersForProduct({ productId: "prod_a" });
    expect(list.some((v) => v.id === broken.id)).toBe(false);
  });
});

describe("领取后 N 天有效（ADR-085）", () => {
  it("valid_days 为空 = 跟随固定区间；1 天 = 领取时刻 + 86400000", () => {
    expect(voucherCodeExpiry(null)).toBeNull();
    expect(voucherCodeExpiry(0)).toBeNull();
    const now = new Date("2026-11-14T10:00:00.000Z");
    expect(voucherCodeExpiry(1, now)?.toISOString()).toBe("2026-11-15T10:00:00.000Z");
    expect(voucherCodeExpiry(30, now)?.toISOString()).toBe("2026-12-14T10:00:00.000Z");
  });
});

describe("券排除范围（ADR-092）", () => {
  it("voucherIncludesItem：include 白名单 / exclude 黑名单", () => {
    const scopes = [{ scope_type: "product" as const, scope_id: "p2" }];
    // 非指定商品券覆盖所有
    expect(voucherIncludesItem("entire_order", "include", [], "p1", [])).toBe(true);
    // include：命中才 true
    expect(voucherIncludesItem("specific_product", "include", scopes, "p2", [])).toBe(true);
    expect(voucherIncludesItem("specific_product", "include", scopes, "p1", [])).toBe(false);
    // exclude：不在排除列表才 true
    expect(voucherIncludesItem("specific_product", "exclude", scopes, "p2", [])).toBe(false);
    expect(voucherIncludesItem("specific_product", "exclude", scopes, "p1", [])).toBe(true);
    // exclude + 空列表 = 全场
    expect(voucherIncludesItem("specific_product", "exclude", [], "p1", [])).toBe(true);
    // scope_mode 缺省按 include（老数据）
    expect(voucherIncludesItem("specific_product", null, scopes, "p1", [])).toBe(false);
  });

  it("computeDiscounts：exclude 券的适用小计 = 整单 - 排除项", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    const voucher = await service.createVoucher({
      name: "除清仓外满 100 减 20",
      type: "specific_product",
      discountType: "fixed",
      discountValue: 2000n,
      minSpent: 10000n,
      scopeMode: "exclude",
      scopes: [{ scopeType: "product", scopeId: "p_clearance" }],
    });
    await service.addVoucherCode({ voucherId: voucher.id, code: "EXCL" });

    // p1 常规商品 200 元 + p_clearance 清仓商品 50 元：排除后适用小计 = 200，满足满 100
    const res = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [
        { id: "cli_1", variantId: "var_1", productId: "p1", categoryIds: [], quantity: 1, unitPriceMinor: 20000n },
        { id: "cli_2", variantId: "var_2", productId: "p_clearance", categoryIds: [], quantity: 1, unitPriceMinor: 5000n },
      ],
      subtotalMinor: 25000n,
      shippingMinor: 0n,
      voucherCodes: ["EXCL"],
      giftCardCodes: [],
    });
    expect(res.voucherDiscountMinor).toBe(2000n);

    // 反过来：车里只有清仓商品，排除后适用小计 = 0，这张券用不了
    const resOnlyClearance = await service.computeDiscounts({
      currencyCode: "CNY",
      items: [
        { id: "cli_2", variantId: "var_2", productId: "p_clearance", categoryIds: [], quantity: 1, unitPriceMinor: 5000n },
      ],
      subtotalMinor: 5000n,
      shippingMinor: 0n,
      voucherCodes: ["EXCL"],
      giftCardCodes: [],
    });
    expect(resOnlyClearance.voucherDiscountMinor).toBe(0n);
  });
});

describe("积分（ADR-093）", () => {
  it("pointsEarnedFromPaid：每 100 minor 发 1 点，向下取整", () => {
    expect(pointsEarnedFromPaid(10000n)).toBe(100n);
    expect(pointsEarnedFromPaid(9999n)).toBe(99n);
    expect(pointsEarnedFromPaid(0n)).toBe(0n);
    expect(pointsEarnedFromPaid(-100n)).toBe(0n);
  });

  it("pointDiscountMinor：1 点抵 1 minor，封顶到应付 50%", () => {
    expect(pointDiscountMinor(100n, 10000n)).toBe(100n);
    // 积分远超应付一半时封顶
    expect(pointDiscountMinor(100000n, 10000n)).toBe(5000n);
    expect(pointDiscountMinor(0n, 10000n)).toBe(0n);
    expect(pointDiscountMinor(100n, 0n)).toBe(0n);
  });

  it("earnPointsForOrder：同一订单只发一次（幂等）", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await service.earnPointsForOrder("cust_1", "ord_1", 10000n);
    await service.earnPointsForOrder("cust_1", "ord_1", 10000n); // 重复发放
    expect(await service.getPointBalance("cust_1")).toBe(100n);
    const ledger = await service.listPointLedger("cust_1", 20, 0);
    expect(ledger.count).toBe(1);
  });
});
