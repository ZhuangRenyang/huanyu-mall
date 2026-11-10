import { prefixedUlid } from "@mall/core";
import {
  giftCardNotFound,
  promotionNotFound,
  promotionRuleNotFound,
  voucherCodeNotFound,
  voucherNotFound,
  voucherUsageLimitReached,
} from "../errors.js";
import type {
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
  PromotionDTO,
  PromotionRepository,
  PromotionRuleDTO,
  UpdateGiftCardInput,
  UpdatePromotionInput,
  UpdateVoucherInput,
  VoucherCodeDTO,
  VoucherDTO,
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
    return this.repo.insertVoucher({ ...input, id: prefixedUlid("vouch") });
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
    return updated!;
  }

  async deleteVoucher(id: string): Promise<void> {
    await this.retrieveVoucher(id);
    await this.repo.softDeleteVoucher(id);
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
    }
  }

  async releaseVoucherCodes(codes: string[]): Promise<void> {
    for (const code of codes) {
      const vc = await this.repo.findVoucherCodeByCode(code);
      if (!vc) continue; // 补偿幂等：券码已删则不回退
      await this.repo.releaseVoucherCodeUsed(vc.id);
    }
  }

  // —— gift_card ——
  async createGiftCard(input: CreateGiftCardInput): Promise<GiftCardDTO> {
    return this.repo.insertGiftCard({ ...input, id: prefixedUlid("gcard") });
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

  // —— gift_card_event ——
  async listGiftCardEvents(giftCardId: string): Promise<GiftCardEventDTO[]> {
    await this.retrieveGiftCard(giftCardId);
    return this.repo.listEventsByGiftCard(giftCardId);
  }

  // —— 折扣计算（阶段 2：目录促销 catalogue 行级折扣；阶段 3：订单促销 order 订单级折扣；voucher/gift card 阶段 4-5 落地）——
  async computeDiscounts(ctx: ComputeDiscountsInput): Promise<ComputeDiscountsResult> {
    const now = new Date();
    const active = await this.repo.listActiveCataloguePromotionsWithRules(now);

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
    const orderPromotions = await this.repo.listActiveOrderPromotionsWithRules(now);
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
    if (ctx.voucherCodes.length > 0) {
      let bestVoucher: { promotionId: string; code: string; amountMinor: bigint } | null = null;
      for (const code of ctx.voucherCodes) {
        const found = await this.repo.findVoucherCodeWithVoucherByCode(code);
        if (!found) continue; // 券码不存在 → 静默跳过（预览语义，不抛错）
        const { code: vc, voucher } = found;
        if (!vc.is_active) continue;
        if (voucher.status !== "active") continue; // 停用即时生效（硬约束 6）
        if (voucher.starts_at && voucher.starts_at.getTime() > now.getTime()) continue;
        if (voucher.ends_at && voucher.ends_at.getTime() < now.getTime()) continue;
        if (voucher.usage_limit !== null && vc.used >= voucher.usage_limit) continue;
        if (voucher.min_spent !== null && ctx.subtotalMinor < voucher.min_spent) continue;

        const amount = computeVoucherDiscount(voucher, ctx.subtotalMinor);
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

    return {
      lineAdjustments,
      orderDiscountMinor,
      orderDiscounts,
      voucherDiscountMinor,
      voucherDiscounts,
      giftCardAppliedMinor: 0n,
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
