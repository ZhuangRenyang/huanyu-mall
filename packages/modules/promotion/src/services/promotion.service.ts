import { DomainError, prefixedUlid } from "@mall/core";
import { randomBytes } from "node:crypto";
import {
  giftCardInsufficientBalance,
  giftCardNotFound,
  promotionNotFound,
  promotionRuleNotFound,
  voucherCodeNotFound,
  voucherCollectLimitReached,
  voucherNotCollectable,
  voucherNotFound,
  voucherUsageLimitReached,
} from "../errors.js";
import type {
  CollectedVoucherDTO,
  ComputeDiscountsInput,
  CreateFlashSaleInput,
  CreateGroupBuyInput,
  FlashSaleDTO,
  FlashSaleStatus,
  GroupBuyDTO,
  GroupBuyStatus,
  GroupBuyTeamDTO,
  PointLedgerDTO,
  ComputeDiscountsResult,
  CreateGiftCardInput,
  CreatePromotionInput,
  CreatePromotionRuleInput,
  CreateVoucherCodeInput,
  CreateVoucherInput,
  GiftCardDTO,
  GiftCardEventDTO,
  IPromotionModuleService,
  ListQuery,
  MarketingFeature,
  PromotionDTO,
  PromotionRepository,
  PromotionRuleDTO,
  PublicVoucherDTO,
  UpdateGiftCardInput,
  UpdatePromotionInput,
  UpdateVoucherInput,
  VoucherCodeDTO,
  VoucherDTO,
  VoucherScopeDTO,
  VoucherScopeInput,
  VoucherType,
} from "../types.js";
import { evalPredicate } from "./predicate.js";
import {
  POINT_DISCOUNT_MINOR_PER_POINT,
  POINT_EARN_DIVISOR_MINOR,
  POINT_MAX_DISCOUNT_RATIO_BPS,
} from "../types.js";

/**
 * M-promotion 对外门面。阶段 1 交付四类实体（promotion / voucher / gift_card + 子表）的 CRUD 骨架；
 * 阶段 2 落地目录促销（catalogue）行级折扣 computeDiscounts（order/voucher/gift card 阶段 3-5 落地，见 ADR-012 §5）。
 */
export class PromotionService implements IPromotionModuleService {
  constructor(private readonly repo: PromotionRepository) {}

  // —— promotion ——
  async createPromotion(input: CreatePromotionInput): Promise<PromotionDTO> {
    return this.repo.insertPromotion({ ...input, id: prefixedUlid("promo") });
  }

  async retrievePromotion(id: string): Promise<PromotionDTO> {
    const promotion = await this.repo.findPromotionById(id);
    if (!promotion) throw promotionNotFound(id);
    return promotion;
  }

  async listPromotions(q: ListQuery): Promise<{ items: PromotionDTO[]; count: number }> {
    return this.repo.listPromotions(q);
  }

  async updatePromotion(id: string, patch: UpdatePromotionInput): Promise<PromotionDTO> {
    await this.retrievePromotion(id);
    const updated = await this.repo.updatePromotion(id, patch);
    return updated!;
  }

  async deletePromotion(id: string): Promise<void> {
    await this.retrievePromotion(id);
    await this.repo.softDeletePromotion(id);
  }

  // —— promotion_rule ——
  async addPromotionRule(input: CreatePromotionRuleInput): Promise<PromotionRuleDTO> {
    await this.retrievePromotion(input.promotionId);
    return this.repo.insertPromotionRule({ ...input, id: prefixedUlid("prorul") });
  }

  async listPromotionRules(promotionId: string): Promise<PromotionRuleDTO[]> {
    await this.retrievePromotion(promotionId);
    return this.repo.listRulesByPromotion(promotionId);
  }

  async deletePromotionRule(ruleId: string): Promise<void> {
    const rule = await this.repo.findPromotionRuleById(ruleId);
    if (!rule) throw promotionRuleNotFound(ruleId);
    await this.repo.softDeletePromotionRule(ruleId);
  }

  // —— voucher ——
  async createVoucher(input: CreateVoucherInput): Promise<VoucherDTO> {
    const voucher = await this.repo.insertVoucher({ ...input, id: prefixedUlid("vouch") });
    if (input.scopes !== undefined) {
      await this.repo.replaceScopes(voucher.id, input.scopes);
    }
    return voucher;
  }

  async retrieveVoucher(id: string): Promise<VoucherDTO> {
    const voucher = await this.repo.findVoucherById(id);
    if (!voucher) throw voucherNotFound(id);
    return voucher;
  }

  async listVouchers(q: ListQuery): Promise<{ items: VoucherDTO[]; count: number }> {
    return this.repo.listVouchers(q);
  }

  async updateVoucher(id: string, patch: UpdateVoucherInput): Promise<VoucherDTO> {
    await this.retrieveVoucher(id);
    const updated = await this.repo.updateVoucher(id, patch);
    // 只有显式传了 scopes 才替换：undefined = 不碰范围（编辑只改名称时别把范围清掉）
    if (patch.scopes !== undefined) {
      await this.repo.replaceScopes(id, patch.scopes);
    }
    return updated!;
  }

  async listVoucherScopes(voucherId: string): Promise<VoucherScopeDTO[]> {
    return this.repo.listScopesByVoucherId(voucherId);
  }

  async listVoucherScopesByVoucherIds(
    voucherIds: string[],
  ): Promise<Record<string, VoucherScopeDTO[]>> {
    return this.repo.listScopesByVoucherIds(voucherIds);
  }

  async deleteVoucher(id: string): Promise<void> {
    await this.retrieveVoucher(id);
    await this.repo.softDeleteVoucher(id);
  }

  // —— 领券（ADR-029）——

  /**
   * 店面可领的店铺券。
   *
   * 只返回「公开 + 启用 + 在有效期」的券；已领张数按顾客算，
   * 未登录时全部按未领处理（点了领取再让他登录）。
   */
  async listPublicVouchers(customerId?: string | null): Promise<PublicVoucherDTO[]> {
    // 营销总开关关着就不该露出券条：领了也用不了（computeDiscounts 同样按开关跳过）
    const flags = await this.getFeatureFlags();
    if (!flags.voucher) return [];
    const now = new Date();
    const { items } = await this.repo.listVouchers({ limit: 100, offset: 0 });
    const collectable = items.filter(
      (v) => v.is_public && v.status === "active" && inWindow(v.starts_at, v.ends_at, now),
    );
    const counts = new Map<string, number>();
    if (customerId) {
      for (const c of await this.repo.listVoucherCollectionsByCustomer(customerId)) {
        counts.set(c.voucher_id, (counts.get(c.voucher_id) ?? 0) + 1);
      }
    }
    const scopesByVoucher = await this.repo.listScopesByVoucherIds(collectable.map((v) => v.id));
    return collectable
      .map((v) => {
        const collected = counts.get(v.id) ?? 0;
        return {
          ...v,
          collected: collected > 0,
          collected_count: collected,
          scopes: (scopesByVoucher[v.id] ?? []).map((sc) => ({
            scope_type: sc.scope_type,
            scope_id: sc.scope_id,
          })),
        };
      })
      .sort((a, b) => Number(b.discount_value) - Number(a.discount_value));
  }

  /**
   * 本商品可用券（ADR-071）。
   *
   * 淘宝商品页的领券区只摆「这个商品能用」的券：整单券、运费券都算可用，
   * 指定商品券必须命中本商品或它挂的分类。空范围的指定商品券按「用不了」排除 ——
   * 与结账时的 eligibleVoucherBase 同一判定，不能出现「这里能领、结账用不了」。
   *
   * 直接复用 listPublicVouchers 再过滤：开关、有效期、已领张数只有一处口径。
   */
  async listPublicVouchersForProduct(input: {
    productId: string;
    categoryIds?: string[];
    customerId?: string | null;
  }): Promise<PublicVoucherDTO[]> {
    const all = await this.listPublicVouchers(input.customerId);
    return all.filter((v) =>
      voucherIncludesItem(v.type, v.scope_mode, v.scopes ?? [], input.productId, input.categoryIds ?? []),
    );
  }

  /**
   * 领取一张店铺券。
   *
   * 实现方式是「自动发一条专属券码」：核销链路（consumeVoucherCodes /
   * releaseVoucherCodes / 溢出保护）一行都不用改，领券只是把码替顾客记下来。
   *
   * 重复领取是幂等的：已经领过的直接返回原码，不做「你已领取」的报错 ——
   * 顾客连点两下不该看到红字。
   */
  async collectVoucher(
    voucherId: string,
    customerId: string,
  ): Promise<{ code: string; alreadyCollected: boolean }> {
    const voucher = await this.repo.findVoucherById(voucherId);
    if (!voucher) throw voucherNotFound(voucherId);
    // 顾客自助领取：券必须是「公开可领」的店铺券
    if (!voucher.is_public) throw voucherNotCollectable(voucher.name);
    return this.issueVoucherToCustomer(voucherId, customerId);
  }

  /**
   * 系统发放（不要求 is_public）：拼团成团后给成员发专享券（ADR-100）。
   *
   * 与「顾客自助领取」共用同一套发码与限领逻辑，只是不检查公开性 ——
   * 这类券本来就不该出现在店铺券列表里。
   */
  private async issueVoucherToCustomer(
    voucherId: string,
    customerId: string,
  ): Promise<{ code: string; alreadyCollected: boolean }> {
    const voucher = await this.repo.findVoucherById(voucherId);
    if (!voucher) throw voucherNotFound(voucherId);
    const flags = await this.getFeatureFlags();
    if (!flags.voucher) throw voucherNotCollectable(voucher.name);
    if (voucher.status !== "active" || !inWindow(voucher.starts_at, voucher.ends_at, new Date())) {
      throw voucherNotCollectable(voucher.name);
    }

    const count = await this.repo.countVoucherCollections(voucherId, customerId);
    // 已领到上限：如果手里还有一张，就把原码还给他（幂等，连点两下不该报错）
    if (count >= voucher.collect_limit) {
      const existing = await this.repo.findVoucherCollection(voucherId, customerId);
      if (existing) return { code: existing.code, alreadyCollected: true };
      throw voucherCollectLimitReached(voucher.collect_limit);
    }

    const code = await this.issueUniqueCode(voucherId);
    /*
     * 领取后 N 天有效（ADR-085）：到期时间落在**码**上，不落在券上 ——
     * 同一张券不同顾客的领取时间不同，只有一个全局 ends_at 时「N 天」无从表达。
     */
    const expiresAt = voucherCodeExpiry(voucher.valid_days);
    if (expiresAt) await this.repo.setVoucherCodeExpiry(code.id, expiresAt);
    await this.repo.insertVoucherCollection({
      id: prefixedUlid("vcol"),
      voucherId,
      customerId,
      codeId: code.id,
    });
    return { code: code.code, alreadyCollected: false };
  }

  async listCollectedVouchers(customerId: string): Promise<CollectedVoucherDTO[]> {
    const list = await this.repo.listVoucherCollectionsByCustomer(customerId);
    const scopesByVoucher = await this.repo.listScopesByVoucherIds(
      [...new Set(list.map((c) => c.voucher_id))],
    );
    // 未用在最前，其次按领取时间倒序（后端已按领取时间倒序）
    return list
      .map((c) => ({
        ...c,
        scopes: (scopesByVoucher[c.voucher_id] ?? []).map((sc) => ({
          scope_type: sc.scope_type,
          scope_id: sc.scope_id,
        })),
      }))
      .sort((a, b) => {
        if (a.status === b.status) return 0;
        return a.status === "unused" ? -1 : 1;
      });
  }

  /** 生成一条没被占用的券码（去掉易混的 I/O/0/1，顾客手输也不会错）。 */
  private async issueUniqueCode(voucherId: string): Promise<VoucherCodeDTO> {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 8; attempt++) {
      const bytes = randomBytes(10);
      let raw = "";
      for (const b of bytes) raw += alphabet[b % alphabet.length];
      const exists = await this.repo.findVoucherCodeByCode(raw);
      if (exists) continue;
      return this.repo.insertVoucherCode({ voucherId, code: raw, id: prefixedUlid("vcode") });
    }
    // 8 次都撞上（几乎不可能）：宁可报错也不要发出重复码
    throw voucherCodeNotFound("could not allocate unique code");
  }

  // —— voucher_code ——
  async addVoucherCode(input: CreateVoucherCodeInput): Promise<VoucherCodeDTO> {
    await this.retrieveVoucher(input.voucherId);
    return this.repo.insertVoucherCode({ ...input, id: prefixedUlid("vcode") });
  }

  async listVoucherCodes(voucherId: string): Promise<VoucherCodeDTO[]> {
    await this.retrieveVoucher(voucherId);
    return this.repo.listCodesByVoucher(voucherId);
  }

  async retrieveVoucherCodeByCode(code: string): Promise<VoucherCodeDTO | null> {
    return this.repo.findVoucherCodeByCode(code);
  }

  async updateVoucherCode(codeId: string, patch: { isActive?: boolean }): Promise<VoucherCodeDTO> {
    const code = await this.repo.findVoucherCodeById(codeId);
    if (!code) throw voucherCodeNotFound(codeId);
    const updated = await this.repo.updateVoucherCode(codeId, patch);
    return updated!;
  }

  async deleteVoucherCode(codeId: string): Promise<void> {
    const code = await this.repo.findVoucherCodeById(codeId);
    if (!code) throw voucherCodeNotFound(codeId);
    await this.repo.softDeleteVoucherCode(codeId);
  }

  // —— voucher 核销（阶段 4）——
  async consumeVoucherCodes(codes: string[]): Promise<void> {
    for (const code of codes) {
      const vc = await this.repo.findVoucherCodeByCode(code);
      if (!vc) throw voucherCodeNotFound(code);
      const res = await this.repo.incrementVoucherCodeUsed(vc.id);
      if (res.exceeded) throw voucherUsageLimitReached(code);
      // 领取来的券：核销后标记已用，顾客的「我的卡券」不会一直显示可使用
      await this.repo.markCollectionUsedByCode(vc.id);
    }
  }

  async releaseVoucherCodes(codes: string[]): Promise<void> {
    for (const code of codes) {
      const vc = await this.repo.findVoucherCodeByCode(code);
      if (!vc) continue; // 补偿幂等：券码已删则不回退
      await this.repo.releaseVoucherCodeUsed(vc.id);
      // 补偿：退回未用（订单失败时券要还给顾客）
      await this.repo.markCollectionUnusedByCode(vc.id);
    }
  }

  // —— gift_card ——
  async createGiftCard(input: CreateGiftCardInput): Promise<GiftCardDTO> {
    const card = await this.repo.insertGiftCard({ ...input, id: prefixedUlid("gcard") });
    // 流水账本只追加：初始余额写 issued 流水（event sourcing，current_balance 是流水汇总缓存，硬约束 6）。
    if (card.initial_balance > 0n) {
      await this.repo.insertGiftCardEvent({
        id: prefixedUlid("gcevt"),
        giftCardId: card.id,
        type: "issued",
        amount: card.initial_balance,
        parameters: { currency: card.currency },
      });
    }
    return card;
  }

  async retrieveGiftCard(id: string): Promise<GiftCardDTO> {
    const giftCard = await this.repo.findGiftCardById(id);
    if (!giftCard) throw giftCardNotFound(id);
    return giftCard;
  }

  async retrieveGiftCardByCode(code: string): Promise<GiftCardDTO> {
    const giftCard = await this.repo.findGiftCardByCode(code);
    if (!giftCard) throw giftCardNotFound(code);
    return giftCard;
  }

  async listGiftCards(q: ListQuery): Promise<{ items: GiftCardDTO[]; count: number }> {
    return this.repo.listGiftCards(q);
  }

  async updateGiftCard(id: string, patch: UpdateGiftCardInput): Promise<GiftCardDTO> {
    await this.retrieveGiftCard(id);
    const updated = await this.repo.updateGiftCard(id, patch);
    return updated!;
  }

  async deleteGiftCard(id: string): Promise<void> {
    await this.retrieveGiftCard(id);
    await this.repo.softDeleteGiftCard(id);
  }

  async setGiftCardActive(id: string, isActive: boolean): Promise<GiftCardDTO> {
    await this.retrieveGiftCard(id);
    const updated = await this.repo.updateGiftCard(id, { isActive });
    await this.repo.insertGiftCardEvent({
      id: prefixedUlid("gcevt"),
      giftCardId: id,
      type: isActive ? "activated" : "deactivated",
      amount: 0n,
    });
    return updated!;
  }

  async adjustGiftCardBalance(
    id: string,
    deltaMinor: bigint,
    parameters?: Record<string, unknown> | null,
  ): Promise<GiftCardDTO> {
    await this.retrieveGiftCard(id);
    if (deltaMinor > 0n) {
      await this.repo.refundGiftCardBalance(id, deltaMinor);
    } else if (deltaMinor < 0n) {
      const res = await this.repo.deductGiftCardBalance(id, -deltaMinor);
      if (res.insufficient) throw giftCardInsufficientBalance(id);
    }
    await this.repo.insertGiftCardEvent({
      id: prefixedUlid("gcevt"),
      giftCardId: id,
      type: "balance_adjusted",
      amount: deltaMinor,
      parameters: parameters ?? null,
    });
    return this.retrieveGiftCard(id);
  }

  // —— gift card 核销（阶段 5：下单成功时原子扣减余额 + 流水；补偿加回）——
  async consumeGiftCards(
    entries: Array<{ code: string; amountMinor: bigint }>,
    orderId: string,
  ): Promise<void> {
    for (const e of entries) {
      const card = await this.repo.findGiftCardByCode(e.code);
      if (!card) throw giftCardNotFound(e.code);
      const res = await this.repo.deductGiftCardBalance(card.id, e.amountMinor);
      if (res.insufficient) throw giftCardInsufficientBalance(e.code);
      await this.repo.insertGiftCardEvent({
        id: prefixedUlid("gcevt"),
        giftCardId: card.id,
        type: "used_in_order",
        amount: -e.amountMinor,
        orderId,
        parameters: { code: e.code },
      });
    }
  }

  async releaseGiftCards(
    entries: Array<{ code: string; amountMinor: bigint }>,
    orderId: string,
  ): Promise<void> {
    for (const e of entries) {
      const card = await this.repo.findGiftCardByCode(e.code);
      if (!card) continue; // 补偿幂等：卡已删则跳过
      await this.repo.refundGiftCardBalance(card.id, e.amountMinor);
      await this.repo.insertGiftCardEvent({
        id: prefixedUlid("gcevt"),
        giftCardId: card.id,
        type: "refunded_in_order",
        amount: e.amountMinor,
        orderId,
        parameters: { code: e.code },
      });
    }
  }

  // —— gift_card_event ——
  async listGiftCardEvents(giftCardId: string): Promise<GiftCardEventDTO[]> {
    await this.retrieveGiftCard(giftCardId);
    return this.repo.listEventsByGiftCard(giftCardId);
  }

  // —— 折扣计算（阶段 2：目录促销 catalogue 行级折扣；阶段 3：订单促销 order 订单级折扣；voucher/gift card 阶段 4-5 落地）——
  // —— 功能开关（默认全部关闭；后台各页面独立打开）——

  async getFeatureFlags(): Promise<Record<MarketingFeature, boolean>> {
    const rows = await this.repo.listFeatureFlags();
    const flags: Record<MarketingFeature, boolean> = {
      promotion: false,
      voucher: false,
      gift_card: false,
      points: false,
    };
    for (const row of rows) flags[row.feature] = row.enabled;
    return flags;
  }

  async setFeatureEnabled(feature: MarketingFeature, enabled: boolean): Promise<void> {
    await this.repo.setFeatureEnabled(feature, enabled);
  }

  // —— points（ADR-093）——

  async getPointBalance(customerId: string): Promise<bigint> {
    return this.repo.getPointBalance(customerId);
  }

  /**
   * 订单完成发放积分（ADR-093）。
   *
   * 幂等：unique partial index（kind='earn' 的 order_id）保证同一订单只发一次。
   * 若重复调用（事件重放），insert ledger 会因唯一约束失败 —— 这里捕获后
   * 返回「已有的那一条」，而不是抛错让整条链路重试。
   */
  async earnPointsForOrder(customerId: string, orderId: string, paidMinor: bigint): Promise<PointLedgerDTO> {
    const points = pointsEarnedFromPaid(paidMinor);
    if (points <= 0n) {
      // 实付不足 1 元没有积分，仍返回一条 0 值流水占位（幂等键不落空）
      return {
        id: `ptl_${orderId}`,
        customer_id: customerId,
        kind: "earn",
        delta: 0n,
        balance_after: await this.repo.getPointBalance(customerId),
        order_id: orderId,
        created_at: new Date().toISOString(),
      };
    }
    try {
      const res = await this.repo.applyPointDelta({
        id: prefixedUlid("ptl"),
        customerId,
        kind: "earn",
        delta: points,
        orderId,
      });
      return {
        id: `ptl_${orderId}`,
        customer_id: customerId,
        kind: "earn",
        delta: points,
        balance_after: res.balance_after,
        order_id: orderId,
        created_at: new Date().toISOString(),
      };
    } catch {
      // 同订单重复发放：返回 0 增量占位，不抛错（事件重放安全）
      return {
        id: `ptl_${orderId}`,
        customer_id: customerId,
        kind: "earn",
        delta: 0n,
        balance_after: await this.repo.getPointBalance(customerId),
        order_id: orderId,
        created_at: new Date().toISOString(),
      };
    }
  }

  async listPointLedger(
    customerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: PointLedgerDTO[]; count: number }> {
    return this.repo.listPointLedger(customerId, limit, offset);
  }

  /**
   * 下单成功扣减积分（ADR-094）：原子减余额 + 写 spend 流水。
   * 余额不足抛错（触发 workflow 整单回滚）—— 服务层校验过封顶，正常不会不足，
   * 但并发下（同顾客两单同时用积分）仍可能超扣，这里守住。
   */
  async consumePointsForOrder(customerId: string, points: bigint, orderId: string): Promise<void> {
    if (points <= 0n) return;
    await this.repo.applyPointDelta({
      id: prefixedUlid("ptl"),
      customerId,
      kind: "spend",
      delta: -points,
      orderId,
    });
  }

  /** workflow 补偿：退回积分（写 refund 流水）。 */
  async releasePointsForOrder(customerId: string, points: bigint, orderId: string): Promise<void> {
    if (points <= 0n) return;
    await this.repo.applyPointDelta({
      id: prefixedUlid("ptl"),
      customerId,
      kind: "refund",
      delta: points,
      orderId,
    });
  }

  /**
   * 退款退回积分（ADR-095）：订单退款后，把这单发放的积分扣回、抵扣的积分退回。
   *
   * 幂等：已写过 refund 流水的订单不再处理（防重复退款重复退回）。
   * 语义：
   * - earn（发放，delta 正）→ 扣回（delta 取负，即 -earn）；
   * - spend（抵扣，delta 负）→ 退回（delta 取正，即 -spend）。
   */
  async refundPointsForOrder(orderId: string): Promise<void> {
    const ledger = await this.repo.listPointLedgerByOrder(orderId);
    if (ledger.length === 0) return;
    if (ledger.some((l) => l.kind === "refund")) return; // 已处理过，幂等返回

    // 先退回抵扣（加回），再扣回发放（减去）——顺序不能反：
    // 先扣 earn 会把余额打成负数（spend 已经扣过一轮），触发余额不足。
    for (const entry of ledger) {
      const customerId = entry.customer_id;
      if (entry.kind === "spend" && entry.delta < 0n) {
        await this.repo.applyPointDelta({
          id: prefixedUlid("ptl"),
          customerId,
          kind: "refund",
          delta: -entry.delta,
          orderId,
        });
      }
    }
    for (const entry of ledger) {
      const customerId = entry.customer_id;
      if (entry.kind === "earn" && entry.delta > 0n) {
        await this.repo.applyPointDelta({
          id: prefixedUlid("ptl"),
          customerId,
          kind: "refund",
          delta: -entry.delta,
          orderId,
        });
      }
    }
  }

  // —— group_buy（ADR-100）——

  /**
   * 创建拼团活动（草稿），同时自动建一张「拼团专享券」。
   *
   * 券是拼团价的**承载物**：成团后每个成员领一张，拿券正常下单。
   * 这样做的好处是拼团不产生自己的订单与支付链路 —— 未成团什么都没发生，
   * 也就不需要「自动退款」，与 ADR-023 不冲突。
   *
   * 券的 `min_spent` 设成原价：买 2 件时只减 1 份差价，不会变成「每件都打折」。
   */
  async createGroupBuy(input: CreateGroupBuyInput): Promise<GroupBuyDTO> {
    const name = input.name?.trim() ?? "";
    if (name === "") throw new DomainError({ code: 20001, message: "请填写活动名称" });
    if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
      throw new DomainError({ code: 20001, message: "结束时间必须晚于开始时间" });
    }
    if (!Number.isInteger(input.teamSize) || input.teamSize < 2 || input.teamSize > 10) {
      throw new DomainError({ code: 20001, message: "成团人数需在 2–10 人之间" });
    }
    if (input.groupPriceMinor <= 0n || input.groupPriceMinor >= input.originalPriceMinor) {
      throw new DomainError({ code: 20001, message: "拼团价必须大于 0 且低于原价" });
    }

    const voucher = await this.createVoucher({
      name: `拼团专享 · ${name}`,
      type: "specific_product",
      discountType: "fixed",
      // 差价 = 原价 − 拼团价：领券后按拼团价成交
      discountValue: input.originalPriceMinor - input.groupPriceMinor,
      // 满原价才减：买多件时只抵扣一份差价
      minSpent: input.originalPriceMinor,
      status: "active",
      // 不公开领取：只有成团的成员能领（走 claimGroupBuyVoucher）
      isPublic: false,
      collectLimit: 1,
      startsAt: input.startsAt,
      // 成团可能在活动最后一刻发生，留 7 天用券窗口
      endsAt: new Date(input.endsAt.getTime() + 7 * 86_400_000),
      scopes: [{ scopeType: "product", scopeId: input.productId }],
    });

    return this.repo.insertGroupBuy({
      id: prefixedUlid("gb"),
      name,
      variantId: input.variantId,
      productId: input.productId,
      title: input.title.trim(),
      originalPriceMinor: input.originalPriceMinor,
      groupPriceMinor: input.groupPriceMinor,
      teamSize: input.teamSize,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      voucherId: voucher.id,
    });
  }

  async listGroupBuys(q: {
    status?: GroupBuyStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: GroupBuyDTO[]; count: number }> {
    return this.repo.listGroupBuys({
      status: q.status,
      limit: q.limit ?? 20,
      offset: q.offset ?? 0,
    });
  }

  /** 上架 / 结束：只改活动状态，已开的团按自己的 expires_at 走。 */
  async setGroupBuyStatus(id: string, status: "active" | "ended"): Promise<GroupBuyDTO> {
    const activity = await this.repo.findGroupBuy(id);
    if (!activity) throw new DomainError({ code: 30001, message: `拼团活动不存在：${id}` });
    if (activity.status === status) return activity;

    const allowed =
      (activity.status === "draft" && status === "active") ||
      (activity.status === "active" && status === "ended");
    if (!allowed) {
      throw new DomainError({
        code: 30002,
        message: `当前状态（${activity.status}）不能变更为 ${status}`,
      });
    }
    const updated = await this.repo.updateGroupBuyStatus(id, status);
    return updated!;
  }

  /** 店面：进行中的拼团（时间窗内；团是否还有空位由参团时判定）。 */
  async listActiveGroupBuys(now: Date = new Date()): Promise<GroupBuyDTO[]> {
    const res = await this.repo.listGroupBuys({ status: "active", limit: 50, offset: 0 });
    return res.items.filter((a) => {
      const starts = new Date(a.starts_at).getTime();
      const ends = new Date(a.ends_at).getTime();
      return starts <= now.getTime() && ends > now.getTime();
    });
  }

  /**
   * 参团：已在本活动 → 返回原团；否则优先补进未满的团，没有就自己开团。
   *
   * 不收款、不建订单、不占库存 —— 这是「参团免费」的全部含义。
   */
  async joinGroupBuy(
    groupBuyId: string,
    customerId: string,
  ): Promise<{ team: GroupBuyTeamDTO; joined: boolean }> {
    const now = new Date();
    const activity = await this.repo.findGroupBuy(groupBuyId);
    if (!activity) throw new DomainError({ code: 30001, message: `拼团活动不存在：${groupBuyId}` });
    if (activity.status !== "active") {
      throw new DomainError({ code: 30002, message: "该拼团活动未上架或已结束" });
    }
    if (new Date(activity.starts_at).getTime() > now.getTime()) {
      throw new DomainError({ code: 30002, message: "该拼团活动还没开始" });
    }
    if (new Date(activity.ends_at).getTime() <= now.getTime()) {
      throw new DomainError({ code: 30002, message: "该拼团活动已结束" });
    }

    // 一个人在同一活动里只能在一个团：重复点「参团」返回原团，不报错
    const existing = await this.repo.findTeamByCustomer(groupBuyId, customerId);
    if (existing) {
      const team = await this.expireTeamIfNeeded(existing, now);
      return { team, joined: false };
    }

    // 先补现有的团：让最早开的那批尽快凑齐
    const forming = await this.repo.listFormingTeams(groupBuyId, now);
    for (const candidate of forming) {
      const slot = await this.repo.addTeamMemberSlot(candidate.id);
      if (!slot.joined) continue; // 被并发抢满 → 换下一个
      await this.repo.insertTeamMember({
        id: prefixedUlid("gbm"),
        teamId: candidate.id,
        customerId,
      });
      const team = await this.repo.findTeam(candidate.id);
      return { team: team!, joined: true };
    }

    // 没有可加入的团：自己开一个（团长算第一个成员）
    const created = await this.repo.insertTeam({
      id: prefixedUlid("gbt"),
      groupBuyId,
      leaderCustomerId: customerId,
      teamSize: activity.team_size,
      expiresAt: new Date(activity.ends_at),
    });
    await this.repo.insertTeamMember({
      id: prefixedUlid("gbm"),
      teamId: created.id,
      customerId,
    });
    const team = await this.repo.findTeam(created.id);
    return { team: team!, joined: true };
  }

  /**
   * 我的拼团。
   *
   * 读到过期未满的团就地改状态（惰性判定）：没有后台定时任务，
   * 状态只在被访问时收敛 —— 与秒杀的活动时间窗同一套思路。
   */
  async listMyGroupBuys(
    customerId: string,
  ): Promise<Array<{ group_buy: GroupBuyDTO; team: GroupBuyTeamDTO }>> {
    const now = new Date();
    const teams = await this.repo.listTeamsByCustomer(customerId);
    const out: Array<{ group_buy: GroupBuyDTO; team: GroupBuyTeamDTO }> = [];
    for (const team of teams) {
      const activity = await this.repo.findGroupBuy(team.group_buy_id);
      if (!activity) continue;
      out.push({ group_buy: activity, team: await this.expireTeamIfNeeded(team, now) });
    }
    return out;
  }

  /**
   * 成团后领拼团专享券（幂等）。
   *
   * 资格只认「我在这个活动里、且我的团已成团」—— 没成团不能领，
   * 否则拼团就退化成「谁都能领的券」。
   */
  async claimGroupBuyVoucher(
    groupBuyId: string,
    customerId: string,
  ): Promise<{ code: string; already_collected: boolean }> {
    const now = new Date();
    const activity = await this.repo.findGroupBuy(groupBuyId);
    if (!activity) throw new DomainError({ code: 30001, message: `拼团活动不存在：${groupBuyId}` });

    const team = await this.repo.findTeamByCustomer(groupBuyId, customerId);
    if (!team) throw new DomainError({ code: 30002, message: "你还没有参加这个拼团" });
    const settled = await this.expireTeamIfNeeded(team, now);
    if (settled.status !== "success") {
      throw new DomainError({
        code: 30002,
        message: settled.status === "expired" ? "这个团已过期，重新参团吧" : "还没成团，凑齐人数后就能领券",
      });
    }

    // 系统发放，不走「自助领取」的公开性校验：这张券本来就不该出现在券列表里
    const res = await this.issueVoucherToCustomer(activity.voucher_id, customerId);
    return { code: res.code, already_collected: res.alreadyCollected };
  }

  /** 过期未满的团就地置为 expired（不靠定时任务）。 */
  private async expireTeamIfNeeded(team: GroupBuyTeamDTO, now: Date): Promise<GroupBuyTeamDTO> {
    if (team.status !== "forming") return team;
    if (new Date(team.expires_at).getTime() > now.getTime()) return team;
    await this.repo.expireTeam(team.id);
    return { ...team, status: "expired" };
  }

  // —— flash_sale（ADR-099）——

  /**
   * 创建秒杀活动（草稿态）。
   *
   * 上架要显式调 `setFlashSaleStatus('active')`：先建草稿、核对无误再上架，
   * 避免「建完就开卖、价格填错了改不了」。
   */
  async createFlashSale(input: CreateFlashSaleInput): Promise<FlashSaleDTO> {
    const name = input.name?.trim() ?? "";
    if (name === "") {
      throw new DomainError({ code: 20001, message: "请填写活动名称" });
    }
    if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
      throw new DomainError({ code: 20001, message: "结束时间必须晚于开始时间" });
    }
    if (!input.items || input.items.length === 0) {
      throw new DomainError({ code: 20001, message: "请至少添加一个秒杀商品" });
    }

    const seen = new Set<string>();
    for (const item of input.items) {
      if (seen.has(item.variantId)) {
        throw new DomainError({ code: 20001, message: `同一个规格不能重复添加：${item.title}` });
      }
      seen.add(item.variantId);
      // 秒杀价必须低于原价：等于原价没意义，高于原价是坑顾客
      if (item.flashPriceMinor <= 0n || item.flashPriceMinor >= item.originalPriceMinor) {
        throw new DomainError({
          code: 20001,
          message: `秒杀价必须大于 0 且低于原价：${item.title}`,
        });
      }
      if (!Number.isInteger(item.stock) || item.stock <= 0) {
        throw new DomainError({ code: 20001, message: `活动库存必须是正整数：${item.title}` });
      }
    }

    const sale = await this.repo.insertFlashSale({
      id: prefixedUlid("fs"),
      name,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    await this.repo.insertFlashSaleItems(
      sale.id,
      input.items.map((item) => ({ ...item, id: prefixedUlid("fsi") })),
    );
    const created = await this.repo.findFlashSale(sale.id);
    return created!;
  }

  async listFlashSales(q: {
    status?: FlashSaleStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: FlashSaleDTO[]; count: number }> {
    return this.repo.listFlashSales({
      status: q.status,
      limit: q.limit ?? 20,
      offset: q.offset ?? 0,
    });
  }

  /**
   * 上架 / 结束。
   *
   * 只允许两个方向：draft→active（上架）、active→ended（提前结束）。
   * 不支持「已结束再上架」：卖过的库存与订单已经发生，重新上架应该新建活动。
   */
  async setFlashSaleStatus(id: string, status: "active" | "ended"): Promise<FlashSaleDTO> {
    const sale = await this.repo.findFlashSale(id);
    if (!sale) throw new DomainError({ code: 30001, message: `秒杀活动不存在：${id}` });
    if (sale.status === status) return sale; // 幂等：重复点击不报错

    const allowed =
      (sale.status === "draft" && status === "active") ||
      (sale.status === "active" && status === "ended");
    if (!allowed) {
      throw new DomainError({
        code: 30002,
        message: `当前状态（${sale.status}）不能变更为 ${status}`,
      });
    }
    const updated = await this.repo.updateFlashSaleStatus(id, status);
    return updated!;
  }

  /**
   * 店面：进行中的秒杀活动。
   *
   * 三重过滤：状态 active、在时间窗内、还有剩余可售商品。
   * 一件都不剩的活动不展示 —— 顾客点进去只看到「已售罄」是坏体验。
   */
  async listActiveFlashSales(now: Date = new Date()): Promise<FlashSaleDTO[]> {
    const res = await this.repo.listFlashSales({ status: "active", limit: 50, offset: 0 });
    return res.items.filter((sale) => {
      const starts = new Date(sale.starts_at).getTime();
      const ends = new Date(sale.ends_at).getTime();
      if (starts > now.getTime() || ends <= now.getTime()) return false;
      return sale.items.some((item) => item.remaining > 0);
    });
  }

  /**
   * 下单成功后扣活动库存（ADR-099）。
   *
   * 任一商品售罄就整单失败：这是「不超卖」的最后一道闸。
   * 本方法内已成功的扣减要自己回滚 —— workflow 的补偿只覆盖**已完成**的步骤，
   * 步骤内部的部分写入不会被 engine 回退。
   */
  async consumeFlashStock(
    entries: Array<{ flashSaleItemId: string; quantity: number }>,
  ): Promise<void> {
    const applied: Array<{ flashSaleItemId: string; quantity: number }> = [];
    for (const entry of entries) {
      if (entry.quantity <= 0) continue;
      const ok = await this.repo.incrementFlashSold(entry.flashSaleItemId, entry.quantity);
      if (!ok) {
        // 售罄：把本次已扣的还回去，再抛错让整单回滚
        for (const done of applied) {
          await this.repo.decrementFlashSold(done.flashSaleItemId, done.quantity);
        }
        throw new DomainError({
          code: 30002,
          message: "秒杀商品已售完，请重新下单",
        });
      }
      applied.push(entry);
    }
  }

  /** workflow 补偿：退回活动库存（下限 0，重复补偿安全）。 */
  async releaseFlashStock(
    entries: Array<{ flashSaleItemId: string; quantity: number }>,
  ): Promise<void> {
    for (const entry of entries) {
      if (entry.quantity <= 0) continue;
      await this.repo.decrementFlashSold(entry.flashSaleItemId, entry.quantity);
    }
  }

  async computeDiscounts(ctx: ComputeDiscountsInput): Promise<ComputeDiscountsResult> {
    const now = new Date();
    // 功能级总开关：关闭的功能整体不参与计算（默认全关，ADR-014）。
    const flags = await this.getFeatureFlags();
    const active = flags.promotion
      ? await this.repo.listActiveCataloguePromotionsWithRules(now)
      : [];

    /*
     * —— 秒杀（ADR-099）：先把秒杀价折下去 ——
     *
     * 秒杀价是「替换原价」，所以必须在所有促销之前算：后面的满减门槛、券的适用小计、
     * 礼品卡与积分的剩余应付，都应该基于**折后**金额 —— 否则顾客能用秒杀价去凑满减。
     * 时间窗与库存（sold < stock）在 SQL 里过滤：过期、未上架、售完的都不参与。
     */
    const flashItems =
      flags.promotion && ctx.items.length > 0
        ? await this.repo.listActiveFlashItemsByVariantIds(
            ctx.items.map((i) => i.variantId),
            now,
          )
        : [];
    const flashByVariant = new Map(flashItems.map((f) => [f.variant_id, f]));
    const flashAdjustments: ComputeDiscountsResult["flashAdjustments"] = [];
    for (const item of ctx.items) {
      const flash = flashByVariant.get(item.variantId);
      if (!flash) continue;
      // 秒杀价不低于原价（商家后来改价导致）→ 不生效，绝不倒贴
      if (item.unitPriceMinor <= flash.flash_price_minor) continue;
      const lineSubtotal = item.unitPriceMinor * BigInt(item.quantity);
      const amount = (item.unitPriceMinor - flash.flash_price_minor) * BigInt(item.quantity);
      flashAdjustments.push({
        itemId: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        // 封顶到行小计（硬约束 3：折扣不能为负、不能超过行金额）
        amountMinor: amount > lineSubtotal ? lineSubtotal : amount,
        flashSaleId: flash.flash_sale_id,
        flashSaleItemId: flash.id,
      });
    }
    const flashDiscountMinor = flashAdjustments.reduce((s, a) => s + a.amountMinor, 0n);
    /** 折后小计：满减、整单券、剩余应付都按它算（与「秒杀价替换原价」同一口径）。 */
    let effectiveSubtotal = ctx.subtotalMinor - flashDiscountMinor;
    if (effectiveSubtotal < 0n) effectiveSubtotal = 0n;
    /** 每行的秒杀优惠额（券的适用金额要按折后算）。 */
    const flashAmountByItem = new Map(flashAdjustments.map((a) => [a.itemId, a.amountMinor]));

    const lineAdjustments: ComputeDiscountsResult["lineAdjustments"] = [];

    for (const item of ctx.items) {
      const lineSubtotalMinor = item.unitPriceMinor * BigInt(item.quantity);
      let best: { amountMinor: bigint; promotionId: string; code: string } | null = null;

      for (const { promotion, rules } of active) {
        for (const rule of rules) {
          const matched = evalPredicate(rule.predicate, {
            variantId: item.variantId,
            categoryIds: item.categoryIds,
            subtotalMinor: ctx.subtotalMinor,
            currencyCode: ctx.currencyCode,
          });
          if (!matched) continue;

          const amount = computeCatalogueRuleDiscount(rule, item.unitPriceMinor, item.quantity);
          // 同一行命中多条目录促销规则时取折扣金额最大的一条（Saleor 的做法）。
          if (best === null || amount > best.amountMinor) {
            best = { amountMinor: amount, promotionId: promotion.id, code: promotion.code ?? "" };
          }
        }
      }

      // 资金安全硬约束 3：折扣不能为负、不能超过行项小计（结果为负/超额直接归零封顶）。
      if (best && best.amountMinor > 0n) {
        const clamped = best.amountMinor > lineSubtotalMinor ? lineSubtotalMinor : best.amountMinor;
        lineAdjustments.push({
          itemId: item.id,
          amountMinor: clamped,
          promotionId: best.promotionId,
          code: best.code,
        });
      }
    }

    // —— 订单促销（阶段 3）：订单级上下文求值，命中取折扣金额最大的一条（与目录促销一致）。——
    const orderPromotions = flags.promotion
      ? await this.repo.listActiveOrderPromotionsWithRules(now)
      : [];
    let bestOrder: { amountMinor: bigint; promotionId: string; code: string | null } | null = null;
    for (const { promotion, rules } of orderPromotions) {
      for (const rule of rules) {
        const matched = evalPredicate(rule.predicate, {
          // 订单级条件（subtotalGte / currencyEq）不看具体行；variant/category 谓词在订单级恒不命中。
          variantId: "",
          categoryIds: [],
          // 门槛按折后小计算（ADR-099）：秒杀价不参与凑满减
          subtotalMinor: effectiveSubtotal,
          currencyCode: ctx.currencyCode,
        });
        if (!matched) continue;

        const amount = computeOrderRuleDiscount(rule, effectiveSubtotal);
        if (bestOrder === null || amount > bestOrder.amountMinor) {
          bestOrder = { amountMinor: amount, promotionId: promotion.id, code: promotion.code ?? null };
        }
      }
    }

    // 封顶到小计（硬约束 3/7：订单级折扣不超过 subtotal，负则归零）。
    let orderDiscountMinor = 0n;
    const orderDiscounts: ComputeDiscountsResult["orderDiscounts"] = [];
    if (bestOrder && bestOrder.amountMinor > 0n) {
      orderDiscountMinor =
        bestOrder.amountMinor > effectiveSubtotal ? effectiveSubtotal : bestOrder.amountMinor;
      orderDiscounts.push({
        promotionId: bestOrder.promotionId,
        code: bestOrder.code,
        amountMinor: orderDiscountMinor,
      });
    }

    // —— Voucher（阶段 4）：输码的订单级折扣，多码命中取折扣金额最大的一条（ADR-012 §3）。——
    let voucherDiscountMinor = 0n;
    const voucherDiscounts: ComputeDiscountsResult["voucherDiscounts"] = [];
    if (flags.voucher && ctx.voucherCodes.length > 0) {
      /*
       * 先做「存在性 / 状态 / 有效期 / 用量」这类基础校验，把候选攒起来；
       * 范围与金额再统一算 —— 这样范围能按 voucherId 一次查全（禁 N+1）。
       */
      const candidates: Array<{ code: VoucherCodeDTO; voucher: VoucherDTO }> = [];
      for (const code of ctx.voucherCodes) {
        const found = await this.repo.findVoucherCodeWithVoucherByCode(code);
        if (!found) continue; // 券码不存在 → 静默跳过（预览语义，不抛错）
        const { code: vc, voucher } = found;
        if (!vc.is_active) continue;
        // 码级到期（领取后 N 天，ADR-085）：与券的固定 ends_at 取交集
        if (vc.expires_at && vc.expires_at.getTime() < now.getTime()) continue;
        if (voucher.status !== "active") continue; // 停用即时生效（硬约束 6）
        if (voucher.starts_at && voucher.starts_at.getTime() > now.getTime()) continue;
        if (voucher.ends_at && voucher.ends_at.getTime() < now.getTime()) continue;
        if (voucher.usage_limit !== null && vc.used >= voucher.usage_limit) continue;
        candidates.push({ code: vc, voucher });
      }

      const scopesByVoucher = await this.repo.listScopesByVoucherIds(
        candidates.map((c) => c.voucher.id),
      );

      let bestVoucher: { promotionId: string; code: string; amountMinor: bigint } | null = null;
      for (const { code: vc, voucher } of candidates) {
        const baseMinor = eligibleVoucherBase(
          voucher,
          scopesByVoucher[voucher.id] ?? [],
          ctx,
          effectiveSubtotal,
          flashAmountByItem,
        );
        // 指定商品券但车里没有一件适用商品 → 这张券用不了（不静默降级成整单）
        if (baseMinor <= 0n) continue;
        // 满减门槛按**适用小计**算：指定商品券的门槛只数命中的那些行
        if (voucher.min_spent !== null && baseMinor < voucher.min_spent) continue;

        let amount = computeVoucherDiscount(voucher, baseMinor);
        if (voucher.type === "shipping") {
          // 运费券只抵运费：没有运费时用不了，抵扣也不超过运费本身
          if (ctx.shippingMinor <= 0n) continue;
          if (amount > ctx.shippingMinor) amount = ctx.shippingMinor;
        } else if (voucher.type === "specific_product") {
          // 指定商品券的折扣不能超过它覆盖的那部分小计
          if (amount > baseMinor) amount = baseMinor;
        }
        if (amount <= 0n) continue;
        if (bestVoucher === null || amount > bestVoucher.amountMinor) {
          bestVoucher = { promotionId: voucher.id, code: vc.code, amountMinor: amount };
        }
      }

      // 封顶到小计（硬约束 3/7）。
      if (bestVoucher) {
        const clamped =
          bestVoucher.amountMinor > effectiveSubtotal ? effectiveSubtotal : bestVoucher.amountMinor;
        voucherDiscountMinor = clamped;
        voucherDiscounts.push({ promotionId: bestVoucher.promotionId, code: bestVoucher.code, amountMinor: clamped });
      }
    }

    // —— Gift Card（阶段 5）：余额抵扣，多卡按顺序累加，封顶到剩余应付（ADR-012 §6 / 硬约束 4）。——
    // 剩余应付 = 小计 + 运费 - (行级折扣 + 订单促销折扣 + voucher 折扣)；gift card 抵扣不能超过剩余应付。
    const lineDiscountMinor =
      lineAdjustments.reduce((s, a) => s + a.amountMinor, 0n) + flashDiscountMinor;
    let remainingMinor =
      ctx.subtotalMinor + ctx.shippingMinor - lineDiscountMinor - orderDiscountMinor - voucherDiscountMinor;
    if (remainingMinor < 0n) remainingMinor = 0n;

    let giftCardAppliedMinor = 0n;
    const giftCardDiscounts: ComputeDiscountsResult["giftCardDiscounts"] = [];
    for (const code of flags.gift_card ? ctx.giftCardCodes : []) {
      if (remainingMinor <= 0n) break;
      const card = await this.repo.findGiftCardByCode(code);
      if (!card) continue; // 卡码不存在 → 静默跳过（预览语义，不抛错）
      if (!card.is_active) continue; // 停用即时生效（硬约束 6）
      if (card.expires_at && card.expires_at.getTime() < now.getTime()) continue;
      if (card.currency !== ctx.currencyCode) continue; // 币种必须匹配（硬约束 5）
      // 防套现：卡若绑定指定客户，必须与当前下单客户一致（硬约束 5）。
      if (card.assigned_to && card.assigned_to !== (ctx.customerId ?? null)) continue;

      const deductible = card.current_balance > remainingMinor ? remainingMinor : card.current_balance;
      if (deductible <= 0n) continue;
      giftCardDiscounts.push({ giftCardId: card.id, code: card.code, amountMinor: deductible });
      giftCardAppliedMinor += deductible;
      remainingMinor -= deductible;
    }

    // —— Points（ADR-094）：积分抵扣，服务端折算 + 封顶（1 点 = 1 minor，封顶到剩余应付的 50%）。——
    let pointsAppliedMinor = 0n;
    let pointsUsed = 0n;
    if (flags.points && ctx.pointsToUse && ctx.pointsToUse > 0n && remainingMinor > 0n) {
      pointsAppliedMinor = pointDiscountMinor(ctx.pointsToUse, remainingMinor);
      pointsUsed = pointsAppliedMinor; // 1 点 = 1 minor，实际用掉点数与抵扣额同值
      remainingMinor -= pointsAppliedMinor;
    }

    return {
      lineAdjustments,
      flashDiscountMinor,
      flashAdjustments,
      orderDiscountMinor,
      orderDiscounts,
      voucherDiscountMinor,
      voucherDiscounts,
      giftCardAppliedMinor,
      giftCardDiscounts,
      pointsAppliedMinor,
      pointsUsed,
    };
  }
}

/**
 * 目录促销单条规则的行级折扣金额（ADR-012 / 资金安全硬约束 1：全程 bigint，禁浮点）。
 * - fixed：折扣 = reward_value（minor unit）× quantity
 * - percentage：折扣 = round(unitPriceMinor × quantity × reward_value / 10000)，reward_value 为万分比 bps
 * 结果恒 >= 0（reward_value/数量/单价均为非负）；封顶到行项小计由调用方负责。
 */
function computeCatalogueRuleDiscount(
  rule: PromotionRuleDTO,
  unitPriceMinor: bigint,
  quantity: number,
): bigint {
  if (rule.reward_type === "fixed") {
    return rule.reward_value * BigInt(quantity);
  }
  // percentage（bps）：round half up，与 core money.toMinor 的「round half away from zero」一致。
  const numerator = unitPriceMinor * BigInt(quantity) * rule.reward_value;
  return (numerator + 5000n) / 10000n;
}

/**
 * 订单促销单条规则的订单级折扣金额（ADR-012 §3 / 资金安全硬约束 1：全程 bigint，禁浮点）。
 * - fixed：折扣 = reward_value（minor unit）
 * - percentage：折扣 = round(subtotalMinor × reward_value / 10000)，reward_value 为万分比 bps
 * 结果恒 >= 0；封顶到小计由调用方负责。
 */
function computeOrderRuleDiscount(rule: PromotionRuleDTO, subtotalMinor: bigint): bigint {
  if (rule.reward_type === "fixed") {
    return rule.reward_value;
  }
  // percentage（bps）：round half up。
  const numerator = subtotalMinor * rule.reward_value;
  return (numerator + 5000n) / 10000n;
}

/**
 * Voucher 单码的订单级折扣金额（ADR-012 §1 / 资金安全硬约束 1：全程 bigint，禁浮点）。
 * - discount_type='fixed'：折扣 = discount_value（minor unit）
 * - discount_type='percentage'：折扣 = round(subtotalMinor × discount_value / 10000)，discount_value 为万分比 bps
 * 结果恒 >= 0；封顶到小计由调用方负责。
 */
function computeVoucherDiscount(voucher: VoucherDTO, subtotalMinor: bigint): bigint {
  /*
   * 阶梯满减（ADR-086）：取「已满足门槛」的最高一档。
   * 一档都没满足返回 0 —— 调用方看到 0 会跳过这张券，不会把它当「不打折但可用」。
   */
  if (voucher.tiers && voucher.tiers.length > 0) {
    const eligible = voucher.tiers
      .filter((t) => subtotalMinor >= BigInt(t.min_spent_minor))
      .sort((a, b) => b.min_spent_minor - a.min_spent_minor);
    if (eligible.length === 0) return 0n;
    const off = BigInt(eligible[0]!.discount_minor);
    // 抵扣不超过适用小计：满 199 减 500 这种配置不能把订单打成负数
    return off > subtotalMinor ? subtotalMinor : off;
  }
  if (voucher.discount_type === "fixed") {
    return voucher.discount_value;
  }
  // percentage（bps）：round half up。
  const numerator = subtotalMinor * voucher.discount_value;
  return (numerator + 5000n) / 10000n;
}

/**
 * 一张券「用来算钱」的基数小计（ADR-064）。
 *
 * - entire_order：整单小计；
 * - shipping：整单小计（门槛看商品钱），抵扣金额在调用方封顶到运费；
 * - specific_product：命中范围（商品/分类）的那些行的小计，没配范围或一行没命中 → 0。
 */
function eligibleVoucherBase(
  voucher: VoucherDTO,
  scopes: VoucherScopeDTO[],
  ctx: ComputeDiscountsInput,
  /** 折后小计（ADR-099）：整单券的适用金额按秒杀后的金额算。 */
  subtotalMinor: bigint,
  /** 每行的秒杀优惠额：指定商品券按折后行金额算。 */
  flashAmountByItem: Map<string, bigint>,
): bigint {
  if (voucher.type !== "specific_product") return subtotalMinor;
  let sum = 0n;
  for (const item of ctx.items) {
    if (voucherIncludesItem(voucher.type, voucher.scope_mode, scopes, item.productId, item.categoryIds)) {
      const line = item.unitPriceMinor * BigInt(item.quantity) - (flashAmountByItem.get(item.id) ?? 0n);
      if (line > 0n) sum += line;
    }
  }
  return sum;
}

/**
 * 券是否覆盖某个商品（ADR-092）。
 *
 * 商品页「可用券」与结账「适用小计」必须用**同一个**判定，否则会出现
 * 「商品页说能用、结账却用不了」的不一致（ADR-071 的同款教训）。
 *
 * - 非 specific_product：全场/运费券，覆盖所有商品；
 * - include：白名单，命中商品/分类才覆盖；
 * - exclude：黑名单，不在排除列表即覆盖（空列表 = 全场）。
 */
export function voucherIncludesItem(
  type: VoucherType,
  scopeMode: "include" | "exclude" | null | undefined,
  scopes: Array<{ scope_type: "product" | "category"; scope_id: string }>,
  productId: string | undefined,
  categoryIds: string[],
): boolean {
  if (type !== "specific_product") return true;
  const mode = scopeMode ?? "include";
  const hitProduct =
    productId !== undefined &&
    scopes.some((s) => s.scope_type === "product" && s.scope_id === productId);
  const hitCategory = scopes.some(
    (s) => s.scope_type === "category" && categoryIds.includes(s.scope_id),
  );
  return mode === "exclude" ? !(hitProduct || hitCategory) : hitProduct || hitCategory;
}

/** 券是否在有效期内（起止都可空，空 = 不限）。 */
function inWindow(startsAt: Date | null, endsAt: Date | null, now: Date): boolean {
  if (startsAt && now < startsAt) return false;
  if (endsAt && now > endsAt) return false;
  return true;
}

/** 领取后 N 天有效的到期时间（ADR-085）：纯函数，便于单测边界。 */
export function voucherCodeExpiry(
  validDays: number | null | undefined,
  now: Date = new Date(),
): Date | null {
  // undefined 也要挡住：老仓储/旧数据没有这个字段，不能算出 Invalid Date
  if (validDays === null || validDays === undefined || validDays <= 0) return null;
  return new Date(now.getTime() + validDays * 86_400_000);
}

/** 实付金额 → 发放积分（ADR-093）：每 POINT_EARN_DIVISOR_MINOR minor 发 1 点，向下取整。 */
export function pointsEarnedFromPaid(paidMinor: bigint): bigint {
  if (paidMinor <= 0n) return 0n;
  return paidMinor / POINT_EARN_DIVISOR_MINOR;
}

/** 积分 → 抵扣金额（ADR-093）：每点抵 POINT_DISCOUNT_MINOR_PER_POINT minor，封顶到应付的 POINT_MAX_DISCOUNT_RATIO_BPS。 */
export function pointDiscountMinor(points: bigint, payableMinor: bigint): bigint {
  if (points <= 0n || payableMinor <= 0n) return 0n;
  const raw = points * POINT_DISCOUNT_MINOR_PER_POINT;
  const cap = (payableMinor * POINT_MAX_DISCOUNT_RATIO_BPS) / 10000n;
  return raw > cap ? cap : raw;
}
