import { prefixedUlid } from "@mall/core";
import {
  giftCardNotFound,
  promotionComputeNotImplemented,
  promotionNotFound,
  promotionRuleNotFound,
  voucherCodeNotFound,
  voucherNotFound,
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

/**
 * M-promotion 对外门面。阶段 1 只交付四类实体（promotion / voucher / gift_card + 子表）的 CRUD 骨架；
 * 折扣计算 computeDiscounts 为占位（阶段 2-5 落地，见 ADR-012 §5）。
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

  async deleteVoucherCode(codeId: string): Promise<void> {
    const code = await this.repo.findVoucherCodeById(codeId);
    if (!code) throw voucherCodeNotFound(codeId);
    await this.repo.softDeleteVoucherCode(codeId);
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

  // —— 折扣计算（阶段 2-5 落地）——
  async computeDiscounts(_ctx: ComputeDiscountsInput): Promise<ComputeDiscountsResult> {
    throw promotionComputeNotImplemented();
  }
}
