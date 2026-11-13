import { prefixedUlid } from "@mall/core";
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
} from "../types.js";
import { evalPredicate } from "./predicate.js";

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
    return collectable
      .map((v) => {
        const collected = counts.get(v.id) ?? 0;
        return { ...v, collected: collected > 0, collected_count: collected };
      })
      .sort((a, b) => Number(b.discount_value) - Number(a.discount_value));
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
    const flags = await this.getFeatureFlags();
    if (!flags.voucher) throw voucherNotCollectable(voucher.name);
    if (!voucher.is_public || voucher.status !== "active" || !inWindow(voucher.starts_at, voucher.ends_at, new Date())) {
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
    // 未用在最前，其次按领取时间倒序（后端已按领取时间倒序）
    return [...list].sort((a, b) => {
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
    };
    for (const row of rows) flags[row.feature] = row.enabled;
    return flags;
  }

  async setFeatureEnabled(feature: MarketingFeature, enabled: boolean): Promise<void> {
    await this.repo.setFeatureEnabled(feature, enabled);
  }

  async computeDiscounts(ctx: ComputeDiscountsInput): Promise<ComputeDiscountsResult> {
    const now = new Date();
    // 功能级总开关：关闭的功能整体不参与计算（默认全关，ADR-014）。
    const flags = await this.getFeatureFlags();
    const active = flags.promotion
      ? await this.repo.listActiveCataloguePromotionsWithRules(now)
      : [];

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
          subtotalMinor: ctx.subtotalMinor,
          currencyCode: ctx.currencyCode,
        });
        if (!matched) continue;

        const amount = computeOrderRuleDiscount(rule, ctx.subtotalMinor);
        if (bestOrder === null || amount > bestOrder.amountMinor) {
          bestOrder = { amountMinor: amount, promotionId: promotion.id, code: promotion.code ?? null };
        }
      }
    }

    // 封顶到小计（硬约束 3/7：订单级折扣不超过 subtotal，负则归零）。
    let orderDiscountMinor = 0n;
    const orderDiscounts: ComputeDiscountsResult["orderDiscounts"] = [];
    if (bestOrder && bestOrder.amountMinor > 0n) {
      orderDiscountMinor = bestOrder.amountMinor > ctx.subtotalMinor ? ctx.subtotalMinor : bestOrder.amountMinor;
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
        const baseMinor = eligibleVoucherBase(voucher, scopesByVoucher[voucher.id] ?? [], ctx);
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
        const clamped = bestVoucher.amountMinor > ctx.subtotalMinor ? ctx.subtotalMinor : bestVoucher.amountMinor;
        voucherDiscountMinor = clamped;
        voucherDiscounts.push({ promotionId: bestVoucher.promotionId, code: bestVoucher.code, amountMinor: clamped });
      }
    }

    // —— Gift Card（阶段 5）：余额抵扣，多卡按顺序累加，封顶到剩余应付（ADR-012 §6 / 硬约束 4）。——
    // 剩余应付 = 小计 + 运费 - (行级折扣 + 订单促销折扣 + voucher 折扣)；gift card 抵扣不能超过剩余应付。
    const lineDiscountMinor = lineAdjustments.reduce((s, a) => s + a.amountMinor, 0n);
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

    return {
      lineAdjustments,
      orderDiscountMinor,
      orderDiscounts,
      voucherDiscountMinor,
      voucherDiscounts,
      giftCardAppliedMinor,
      giftCardDiscounts,
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
): bigint {
  if (voucher.type !== "specific_product") return ctx.subtotalMinor;
  if (scopes.length === 0) return 0n;
  const productIds = new Set(scopes.filter((s) => s.scope_type === "product").map((s) => s.scope_id));
  const categoryIds = new Set(scopes.filter((s) => s.scope_type === "category").map((s) => s.scope_id));
  let sum = 0n;
  for (const item of ctx.items) {
    const hitProduct = item.productId !== undefined && productIds.has(item.productId);
    const hitCategory = item.categoryIds.some((c) => categoryIds.has(c));
    if (hitProduct || hitCategory) sum += item.unitPriceMinor * BigInt(item.quantity);
  }
  return sum;
}

/** 券是否在有效期内（起止都可空，空 = 不限）。 */
function inWindow(startsAt: Date | null, endsAt: Date | null, now: Date): boolean {
  if (startsAt && now < startsAt) return false;
  if (endsAt && now > endsAt) return false;
  return true;
}
