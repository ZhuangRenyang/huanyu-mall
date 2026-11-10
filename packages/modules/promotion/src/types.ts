/** M-promotion DTO 与契约（对齐 ADR-012）。金额一律 bigint minor unit，禁浮点。 */

// —— 类型化 predicate（ADR-012 §2）——
export type PromotionPredicate =
  | { and: PromotionPredicate[] }
  | { or: PromotionPredicate[] }
  | { variantIds: string[] }
  | { categoryIds: string[] }
  | { collectionIds: string[] }
  | { subtotalGte: number } // minor unit
  | { currencyEq: string };

// —— 枚举字面量 ——
export type PromotionType = "catalogue" | "order";
export type PromotionStatus = "draft" | "active" | "inactive";
export type RewardType = "fixed" | "percentage";
export type Allocation = "each" | "across" | "once";
export type VoucherType = "entire_order" | "shipping" | "specific_product";
export type VoucherStatus = "active" | "disabled";
export type DiscountType = "fixed" | "percentage";
export type GiftCardEventType =
  | "issued"
  | "used_in_order"
  | "refunded_in_order"
  | "balance_adjusted"
  | "deactivated"
  | "activated";

// —— DTO ——
export interface PromotionDTO {
  id: string;
  name: string;
  code: string | null;
  type: PromotionType;
  status: PromotionStatus;
  is_automatic: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  usage_limit: number | null;
  used: number;
  metadata: Record<string, unknown> | null;
}

export interface PromotionRuleDTO {
  id: string;
  promotion_id: string;
  predicate: PromotionPredicate;
  reward_type: RewardType;
  reward_value: bigint;
  allocation: Allocation | null;
}

export interface VoucherDTO {
  id: string;
  name: string;
  type: VoucherType;
  usage_limit: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  discount_type: DiscountType;
  discount_value: bigint;
  min_spent: bigint | null;
  status: VoucherStatus;
}

export interface VoucherCodeDTO {
  id: string;
  voucher_id: string;
  code: string;
  used: number;
  is_active: boolean;
}

export interface GiftCardDTO {
  id: string;
  code: string;
  currency: string;
  initial_balance: bigint;
  current_balance: bigint;
  is_active: boolean;
  expires_at: Date | null;
  assigned_to: string | null;
}

export interface GiftCardEventDTO {
  id: string;
  gift_card_id: string;
  type: GiftCardEventType;
  amount: bigint;
  order_id: string | null;
  parameters: Record<string, unknown> | null;
  created_at: Date;
}

// —— 入参 ——
export interface CreatePromotionInput {
  name: string;
  code?: string | null;
  type: PromotionType;
  status?: PromotionStatus;
  isAutomatic?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  usageLimit?: number | null;
  metadata?: Record<string, unknown> | null;
}
export type UpdatePromotionInput = Partial<CreatePromotionInput>;

export interface CreatePromotionRuleInput {
  promotionId: string;
  predicate?: PromotionPredicate;
  rewardType: RewardType;
  rewardValue: bigint;
  allocation?: Allocation | null;
}

export interface CreateVoucherInput {
  name: string;
  type?: VoucherType;
  usageLimit?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  discountType: DiscountType;
  discountValue: bigint;
  minSpent?: bigint | null;
  status?: VoucherStatus;
}
export type UpdateVoucherInput = Partial<CreateVoucherInput>;

export interface CreateVoucherCodeInput {
  voucherId: string;
  code: string;
  isActive?: boolean;
}

export interface CreateGiftCardInput {
  code: string;
  currency: string;
  initialBalance: bigint;
  isActive?: boolean;
  expiresAt?: Date | null;
  assignedTo?: string | null;
}
export type UpdateGiftCardInput = Partial<CreateGiftCardInput>;

export interface ListQuery {
  limit: number;
  offset: number;
}

// —— computeDiscounts（ADR-012 §5，阶段 2-5 落地）——
export interface ComputeDiscountsInput {
  currencyCode: string;
  customerId?: string | null;
  items: Array<{
    id: string;
    variantId: string;
    categoryIds: string[];
    quantity: number;
    unitPriceMinor: bigint;
  }>;
  subtotalMinor: bigint;
  shippingMinor: bigint;
  voucherCodes: string[];
  giftCardCodes: string[];
}

export interface ComputeDiscountsResult {
  lineAdjustments: Array<{ itemId: string; amountMinor: bigint; promotionId: string; code: string }>;
  orderDiscountMinor: bigint;
  /** 命中的订单促销明细（多命中取折扣最大的一条，见 ADR-012 §3）。供下单侧固化进 order_discount 留痕。 */
  orderDiscounts: Array<{ promotionId: string; code: string | null; amountMinor: bigint }>;
  voucherDiscountMinor: bigint;
  giftCardAppliedMinor: bigint;
}

// —— Repository（drizzle 实现 + InMemory 测试桩）——
export interface PromotionRepository {
  // promotion
  insertPromotion(input: CreatePromotionInput & { id: string }): Promise<PromotionDTO>;
  findPromotionById(id: string): Promise<PromotionDTO | null>;
  listPromotions(q: ListQuery): Promise<{ items: PromotionDTO[]; count: number }>;
  updatePromotion(id: string, patch: UpdatePromotionInput): Promise<PromotionDTO | null>;
  softDeletePromotion(id: string): Promise<void>;
  /** 目录促销算折扣：active + catalogue + 有效期内的 promotion 连同其 rules（一次查询，禁 N+1）。 */
  listActiveCataloguePromotionsWithRules(
    now: Date,
  ): Promise<Array<{ promotion: PromotionDTO; rules: PromotionRuleDTO[] }>>;
  /** 订单促销算折扣：active + order + 有效期内的 promotion 连同其 rules（一次查询，禁 N+1）。 */
  listActiveOrderPromotionsWithRules(
    now: Date,
  ): Promise<Array<{ promotion: PromotionDTO; rules: PromotionRuleDTO[] }>>;

  // promotion_rule
  insertPromotionRule(input: CreatePromotionRuleInput & { id: string }): Promise<PromotionRuleDTO>;
  findPromotionRuleById(id: string): Promise<PromotionRuleDTO | null>;
  listRulesByPromotion(promotionId: string): Promise<PromotionRuleDTO[]>;
  softDeletePromotionRule(id: string): Promise<void>;

  // voucher
  insertVoucher(input: CreateVoucherInput & { id: string }): Promise<VoucherDTO>;
  findVoucherById(id: string): Promise<VoucherDTO | null>;
  listVouchers(q: ListQuery): Promise<{ items: VoucherDTO[]; count: number }>;
  updateVoucher(id: string, patch: UpdateVoucherInput): Promise<VoucherDTO | null>;
  softDeleteVoucher(id: string): Promise<void>;

  // voucher_code
  insertVoucherCode(input: CreateVoucherCodeInput & { id: string }): Promise<VoucherCodeDTO>;
  findVoucherCodeById(id: string): Promise<VoucherCodeDTO | null>;
  findVoucherCodeByCode(code: string): Promise<VoucherCodeDTO | null>;
  listCodesByVoucher(voucherId: string): Promise<VoucherCodeDTO[]>;
  softDeleteVoucherCode(id: string): Promise<void>;

  // gift_card
  insertGiftCard(input: CreateGiftCardInput & { id: string }): Promise<GiftCardDTO>;
  findGiftCardById(id: string): Promise<GiftCardDTO | null>;
  findGiftCardByCode(code: string): Promise<GiftCardDTO | null>;
  listGiftCards(q: ListQuery): Promise<{ items: GiftCardDTO[]; count: number }>;
  updateGiftCard(id: string, patch: UpdateGiftCardInput): Promise<GiftCardDTO | null>;
  softDeleteGiftCard(id: string): Promise<void>;

  // gift_card_event
  insertGiftCardEvent(input: {
    id: string;
    giftCardId: string;
    type: GiftCardEventType;
    amount: bigint;
    orderId?: string | null;
    parameters?: Record<string, unknown> | null;
  }): Promise<GiftCardEventDTO>;
  listEventsByGiftCard(giftCardId: string): Promise<GiftCardEventDTO[]>;
}

// —— Service 门面 ——
export interface IPromotionModuleService {
  // promotion
  createPromotion(input: CreatePromotionInput): Promise<PromotionDTO>;
  retrievePromotion(id: string): Promise<PromotionDTO>;
  listPromotions(q: ListQuery): Promise<{ items: PromotionDTO[]; count: number }>;
  updatePromotion(id: string, patch: UpdatePromotionInput): Promise<PromotionDTO>;
  deletePromotion(id: string): Promise<void>;

  // promotion_rule
  addPromotionRule(input: CreatePromotionRuleInput): Promise<PromotionRuleDTO>;
  listPromotionRules(promotionId: string): Promise<PromotionRuleDTO[]>;
  deletePromotionRule(ruleId: string): Promise<void>;

  // voucher
  createVoucher(input: CreateVoucherInput): Promise<VoucherDTO>;
  retrieveVoucher(id: string): Promise<VoucherDTO>;
  listVouchers(q: ListQuery): Promise<{ items: VoucherDTO[]; count: number }>;
  updateVoucher(id: string, patch: UpdateVoucherInput): Promise<VoucherDTO>;
  deleteVoucher(id: string): Promise<void>;

  // voucher_code
  addVoucherCode(input: CreateVoucherCodeInput): Promise<VoucherCodeDTO>;
  listVoucherCodes(voucherId: string): Promise<VoucherCodeDTO[]>;
  deleteVoucherCode(codeId: string): Promise<void>;

  // gift_card
  createGiftCard(input: CreateGiftCardInput): Promise<GiftCardDTO>;
  retrieveGiftCard(id: string): Promise<GiftCardDTO>;
  retrieveGiftCardByCode(code: string): Promise<GiftCardDTO>;
  listGiftCards(q: ListQuery): Promise<{ items: GiftCardDTO[]; count: number }>;
  updateGiftCard(id: string, patch: UpdateGiftCardInput): Promise<GiftCardDTO>;
  deleteGiftCard(id: string): Promise<void>;

  // gift_card_event
  listGiftCardEvents(giftCardId: string): Promise<GiftCardEventDTO[]>;

  // 折扣计算（阶段 2-5 落地，阶段 1 占位抛 notImplemented）
  computeDiscounts(ctx: ComputeDiscountsInput): Promise<ComputeDiscountsResult>;
}
