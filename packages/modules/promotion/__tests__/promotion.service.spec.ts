import { describe, expect, it } from "vitest";
import { PromotionService } from "../src/services/promotion.service.js";
import type {
  CreateGiftCardInput,
  CreatePromotionInput,
  CreatePromotionRuleInput,
  CreateVoucherCodeInput,
  CreateVoucherInput,
  GiftCardDTO,
  GiftCardEventDTO,
  GiftCardEventType,
  ListQuery,
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
  voucherCodes = new Map<string, VoucherCodeDTO>();
  giftCards = new Map<string, GiftCardDTO>();
  giftCardEvents = new Map<string, GiftCardEventDTO[]>();

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
    };
    this.vouchers.set(id, next);
    return next;
  }
  async softDeleteVoucher(id: string): Promise<void> {
    this.vouchers.delete(id);
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
  async listCodesByVoucher(voucherId: string): Promise<VoucherCodeDTO[]> {
    return [...this.voucherCodes.values()].filter((c) => c.voucher_id === voucherId);
  }
  async softDeleteVoucherCode(id: string): Promise<void> {
    this.voucherCodes.delete(id);
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

    await repo.insertGiftCardEvent({
      id: "gcevt_test",
      giftCardId: card.id,
      type: "issued",
      amount: 50000n,
    });
    const events = await service.listGiftCardEvents(card.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("issued");
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

  it("查询不存在的资源抛领域错误", async () => {
    const repo = new InMemoryPromotionRepository();
    const service = new PromotionService(repo);
    await expect(service.retrieveVoucher("vouch_missing")).rejects.toThrow(/Voucher not found/);
    await expect(service.retrieveGiftCard("gcard_missing")).rejects.toThrow(/Gift card not found/);
  });
});
