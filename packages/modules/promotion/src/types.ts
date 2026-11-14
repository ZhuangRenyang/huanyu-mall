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
  /** 店面是否公开可领（店铺券）；false = 只能凭码使用（ADR-029）。 */
  is_public: boolean;
  /** 每个顾客最多领几张。 */
  collect_limit: number;
  /** 领取后 N 天有效（ADR-085）；空 = 只用固定区间。 */
  valid_days: number | null;
  /** 阶梯满减（ADR-086）；空 = 单档。 */
  tiers: Array<{ min_spent_minor: number; discount_minor: number }> | null;
  /** 适用范围模式（ADR-092）：include = 指定可用；exclude = 指定不可用。 */
  scope_mode: "include" | "exclude";
}

/** 券适用范围（ADR-064）：product=指定商品，category=指定分类。 */
export interface VoucherScopeDTO {
  id: string;
  voucher_id: string;
  scope_type: "product" | "category";
  scope_id: string;
}

export type VoucherScopeInput = { scopeType: "product" | "category"; scopeId: string };

export interface VoucherCodeDTO {
  id: string;
  voucher_id: string;
  code: string;
  used: number;
  is_active: boolean;
  /** 领取时按 valid_days 算出的到期时间（ADR-085）；空 = 跟随券 ends_at。 */
  expires_at: Date | null;
}

/** 我的卡券（领取记录 + 券信息平铺，店面列表直接渲染）。 */
export interface CollectedVoucherDTO {
  id: string;
  voucher_id: string;
  /** 领取时发出的券码：结账时把它塞进购物车即可。 */
  code: string;
  name: string;
  type: VoucherType;
  discount_type: DiscountType;
  discount_value: bigint;
  min_spent: bigint | null;
  starts_at: Date | null;
  ends_at: Date | null;
  /** unused | used；过期由 ends_at 现算（前端展示「已过期」）。 */
  status: "unused" | "used";
  collected_at: Date;
  used_at: Date | null;
  /** 适用范围（ADR-066）：type='specific_product' 时非空。 */
  scopes?: Array<{ scope_type: "product" | "category"; scope_id: string }>;
}

/** 店面公开券：券信息 + 当前顾客是否已领（未登录时为 false）。 */
export interface PublicVoucherDTO extends VoucherDTO {
  collected: boolean;
  /** 已领张数（配合 collect_limit 展示「还可领 N 张」）。 */
  collected_count: number;
  /**
   * 适用范围（ADR-066）：type='specific_product' 时非空。
   * 店面据此提示「限 N 件商品 / N 个分类」，别让顾客领了全店都用不上的券。
   */
  scopes?: Array<{ scope_type: "product" | "category"; scope_id: string }>;
}

/**
 * 积分规则常量（ADR-093）。
 *
 * 积分是「点」，整数；与金额的换算用下面三个常量，先固定、后续做成店铺设置：
 * - 发放：实付每 100 minor（1 元）发 1 点；
 * - 抵扣：1 点抵 1 minor（100 点 = 1 元）；
 * - 上限：积分抵扣不超过订单应付的 50%（bps）。
 */
export const POINT_EARN_DIVISOR_MINOR = 100n;
export const POINT_DISCOUNT_MINOR_PER_POINT = 1n;
export const POINT_MAX_DISCOUNT_RATIO_BPS = 5000n;

/** 积分流水类型（ADR-093）。 */
export type PointLedgerKind = "earn" | "spend" | "refund" | "adjust";

export interface PointBalanceDTO {
  customer_id: string;
  /** 当前积分（点数，整数）。 */
  balance: bigint;
}

export interface PointLedgerDTO {
  id: string;
  customer_id: string;
  kind: PointLedgerKind;
  /** 正=增加，负=减少。 */
  delta: bigint;
  balance_after: bigint;
  order_id: string | null;
  created_at: string;
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
  /** 店面公开可领（店铺券）。 */
  isPublic?: boolean;
  /** 每人限领。 */
  collectLimit?: number;
  /** 领取后 N 天有效（ADR-085）。 */
  validDays?: number | null;
  /** 阶梯满减（ADR-086）。 */
  tiers?: Array<{ min_spent_minor: number; discount_minor: number }> | null;
  /** 适用范围模式（ADR-092）：include（默认）= 指定可用；exclude = 指定不可用。 */
  scopeMode?: "include" | "exclude";
  /**
   * 适用范围（ADR-064）：仅 type='specific_product' 时生效。
   * 创建时 type 为 specific_product 必须给至少一条；更新时不给 = 不改变范围。
   */
  scopes?: VoucherScopeInput[];
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
  /** 关键字：促销/券按名称，礼品卡按卡号（后台列表搜索）。 */
  q?: string;
}

/** 促销列表：额外支持类型与状态筛选（必须在 SQL 里筛，不能拉全量再内存过滤）。 */
export interface PromotionListQuery extends ListQuery {
  type?: PromotionType;
  status?: PromotionStatus;
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
    /** 商品 id：指定商品券按它判定（缺省时只能按分类命中）。 */
    productId?: string;
  }>;
  subtotalMinor: bigint;
  shippingMinor: bigint;
  voucherCodes: string[];
  giftCardCodes: string[];
  /** 顾客想用的积分数（ADR-093/094）：服务端折算成抵扣额并封顶。 */
  pointsToUse?: bigint;
}

export interface ComputeDiscountsResult {
  lineAdjustments: Array<{ itemId: string; amountMinor: bigint; promotionId: string; code: string }>;
  orderDiscountMinor: bigint;
  /** 命中的订单促销明细（多命中取折扣最大的一条，见 ADR-012 §3）。供下单侧固化进 order_discount 留痕。 */
  orderDiscounts: Array<{ promotionId: string; code: string | null; amountMinor: bigint }>;
  voucherDiscountMinor: bigint;
  /** 命中的 Voucher 明细（多码命中取折扣最大的一条）。供下单侧固化进 order_discount 留痕（type='voucher'）。 */
  voucherDiscounts: Array<{ promotionId: string; code: string; amountMinor: bigint }>;
  giftCardAppliedMinor: bigint;
  /** 命中的 Gift Card 明细（多卡按顺序累加抵扣，封顶到剩余应付）。供下单侧固化 order_discount 留痕（type='gift_card'）并扣减余额。 */
  giftCardDiscounts: Array<{ giftCardId: string; code: string; amountMinor: bigint }>;
  /** 秒杀优惠合计（ADR-099）：行级，直接抵到原价上。 */
  flashDiscountMinor: bigint;
  /**
   * 命中的秒杀明细（ADR-099）。供购物车算折后行金额（计税基数）与下单侧
   * 固化 order_discount 留痕（type='flash'）、扣减活动库存（按 quantity）。
   */
  flashAdjustments: Array<{
    itemId: string;
    variantId: string;
    quantity: number;
    amountMinor: bigint;
    flashSaleId: string;
    flashSaleItemId: string;
  }>;
  /** 积分抵扣金额（ADR-094）：服务端按 pointsToUse 折算并封顶。 */
  pointsAppliedMinor: bigint;
  /** 实际用掉的积分数（1 点 = 1 minor，与 pointsAppliedMinor 同值）。 */
  pointsUsed: bigint;
}

// —— Repository（drizzle 实现 + InMemory 测试桩）——
/**
 * 秒杀活动状态（ADR-099）。
 *
 * draft → active → ended。上架前是草稿（不参与计算），结束后不再生效；
 * 不做「自动结束」的后台任务：读的时候按时间窗判断，状态只表达商家的意图。
 */
export type FlashSaleStatus = "draft" | "active" | "ended";

/** 秒杀活动商品（ADR-099）。 */
export interface FlashSaleItemDTO {
  id: string;
  flash_sale_id: string;
  variant_id: string;
  /** 商品/规格快照。 */
  title: string;
  original_price_minor: bigint;
  flash_price_minor: bigint;
  /** 活动库存（营销限量，不是仓库库存）。 */
  stock: number;
  sold: number;
  /** 剩余可售 = stock - sold。 */
  remaining: number;
}

/** 秒杀活动（ADR-099）。 */
export interface FlashSaleDTO {
  id: string;
  name: string;
  status: FlashSaleStatus;
  starts_at: string;
  ends_at: string;
  items: FlashSaleItemDTO[];
}

export interface FlashSaleItemInput {
  variantId: string;
  /** 商品/规格快照（由调用侧取好传入）。 */
  title: string;
  originalPriceMinor: bigint;
  flashPriceMinor: bigint;
  stock: number;
}

export interface CreateFlashSaleInput {
  name: string;
  startsAt: Date;
  endsAt: Date;
  items: FlashSaleItemInput[];
}

/** 营销功能级开关（页面级总开关）：关闭后该功能整体不参与计算。 */
export type MarketingFeature = "promotion" | "voucher" | "gift_card" | "points";

export interface MarketingFeatureDTO {
  feature: MarketingFeature;
  enabled: boolean;
}

export interface PromotionRepository {
  // promotion
  insertPromotion(input: CreatePromotionInput & { id: string }): Promise<PromotionDTO>;
  findPromotionById(id: string): Promise<PromotionDTO | null>;
  listPromotions(q: PromotionListQuery): Promise<{ items: PromotionDTO[]; count: number }>;
  updatePromotion(id: string, patch: UpdatePromotionInput): Promise<PromotionDTO | null>;
  softDeletePromotion(id: string): Promise<void>;
  /** 目录促销算折扣：active + catalogue + 有效期内的 promotion 连同其 rules（一次查询，禁 N+1）。 */
  /** 功能开关（默认全部关闭，由后台逐页打开）。 */
  listFeatureFlags(): Promise<MarketingFeatureDTO[]>;
  setFeatureEnabled(feature: MarketingFeature, enabled: boolean): Promise<void>;
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

  // voucher_scope（ADR-064）
  /** 批量取多张券的范围（computeDiscounts 一次查全，禁 N+1）。 */
  listScopesByVoucherIds(voucherIds: string[]): Promise<Record<string, VoucherScopeDTO[]>>;
  /** 单张券的范围（编辑回填用）。 */
  listScopesByVoucherId(voucherId: string): Promise<VoucherScopeDTO[]>;
  /** 整表替换范围（先删后插）：编辑时随券一起保存。 */
  replaceScopes(voucherId: string, scopes: VoucherScopeInput[]): Promise<void>;

  // voucher_collection（ADR-029）
  insertVoucherCollection(input: {
    id: string;
    voucherId: string;
    customerId: string;
    codeId: string;
  }): Promise<void>;
  countVoucherCollections(voucherId: string, customerId: string): Promise<number>;
  listVoucherCollectionsByCustomer(customerId: string): Promise<CollectedVoucherDTO[]>;
  /** 幂等领取用：该顾客在这张券上已有的码。 */
  findVoucherCollection(voucherId: string, customerId: string): Promise<{ code: string } | null>;
  /** 核销后把领取记录标为已用（我的卡券才不会一直显示可用）。 */
  markCollectionUsedByCode(codeId: string): Promise<void>;
  /** 补偿：退回未用。 */
  markCollectionUnusedByCode(codeId: string): Promise<void>;

  // voucher_code
  insertVoucherCode(input: CreateVoucherCodeInput & { id: string }): Promise<VoucherCodeDTO>;
  /** 给券码写入到期时间（领取时按 valid_days 计算，ADR-085）。 */
  setVoucherCodeExpiry(id: string, expiresAt: Date): Promise<void>;
  findVoucherCodeById(id: string): Promise<VoucherCodeDTO | null>;
  findVoucherCodeByCode(code: string): Promise<VoucherCodeDTO | null>;
  /** 按 code 联查 voucher_code + 其归属 voucher（computeDiscounts 单次查询，禁 N+1）。 */
  findVoucherCodeWithVoucherByCode(
    code: string,
  ): Promise<{ code: VoucherCodeDTO; voucher: VoucherDTO } | null>;
  listCodesByVoucher(voucherId: string): Promise<VoucherCodeDTO[]>;
  updateVoucherCode(codeId: string, patch: { isActive?: boolean }): Promise<VoucherCodeDTO | null>;
  softDeleteVoucherCode(id: string): Promise<void>;
  /**
   * 原子自增 voucher_code.used（行锁 + 事务，防并发超用，资金安全硬约束 3）。
   * 返回自增后的 used、券的 usage_limit、以及是否超限（超限时**不**自增）。
   */
  incrementVoucherCodeUsed(
    codeId: string,
  ): Promise<{ used: number; usageLimit: number | null; exceeded: boolean }>;
  /** 原子回退一次 used（workflow 补偿用），下限 0。 */
  releaseVoucherCodeUsed(codeId: string): Promise<void>;

  // gift_card
  insertGiftCard(input: CreateGiftCardInput & { id: string }): Promise<GiftCardDTO>;
  findGiftCardById(id: string): Promise<GiftCardDTO | null>;
  findGiftCardByCode(code: string): Promise<GiftCardDTO | null>;
  listGiftCards(q: ListQuery): Promise<{ items: GiftCardDTO[]; count: number }>;
  updateGiftCard(id: string, patch: UpdateGiftCardInput): Promise<GiftCardDTO | null>;
  softDeleteGiftCard(id: string): Promise<void>;
  /**
   * 原子扣减礼品卡余额（行锁 + 事务，防并发套现，资金安全硬约束 3）。
   * 事务内 `SELECT ... FOR UPDATE` 锁行，余额不足返回 insufficient:true（不扣），
   * 否则 `current_balance = current_balance - amount`，受 DB CHECK 约束 current_balance>=0 兜底。
   */
  deductGiftCardBalance(cardId: string, amountMinor: bigint): Promise<{ balance: bigint; insufficient: boolean }>;
  /** 原子加回余额（workflow 补偿用）。 */
  refundGiftCardBalance(cardId: string, amountMinor: bigint): Promise<void>;

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

  // flash_sale（ADR-099）
  insertFlashSale(row: { id: string; name: string; startsAt: Date; endsAt: Date }): Promise<FlashSaleDTO>;
  insertFlashSaleItems(
    saleId: string,
    items: Array<FlashSaleItemInput & { id: string }>,
  ): Promise<void>;
  findFlashSale(id: string): Promise<FlashSaleDTO | null>;
  listFlashSales(q: {
    status?: FlashSaleStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: FlashSaleDTO[]; count: number }>;
  /** 批量取活动商品（列表拼装，一次 IN 查询，禁 N+1）。 */
  listFlashItemsBySaleIds(saleIds: string[]): Promise<Record<string, FlashSaleItemDTO[]>>;
  updateFlashSaleStatus(id: string, status: FlashSaleStatus): Promise<FlashSaleDTO | null>;
  /** 指定变体的**正在生效**的秒杀商品（状态 active + 时间窗内 + 还有剩余）。 */
  listActiveFlashItemsByVariantIds(variantIds: string[], now: Date): Promise<FlashSaleItemDTO[]>;
  /**
   * 原子扣活动库存：仅当 `sold + quantity <= stock` 时成功（条件 UPDATE）。
   * 返回 false = 已售罄（调用侧据此回滚整单，绝不落到「卖了但超量」）。
   */
  incrementFlashSold(itemId: string, quantity: number): Promise<boolean>;
  /** 补偿：退回活动库存（下限 0，重复补偿不会把 sold 打成负数）。 */
  decrementFlashSold(itemId: string, quantity: number): Promise<void>;

  // points（ADR-093）
  getPointBalance(customerId: string): Promise<bigint>;
  /** 原子增减积分并写流水；余额非负由 DB CHECK 兜底。返回变动后余额。 */
  applyPointDelta(input: {
    id: string;
    customerId: string;
    kind: PointLedgerKind;
    delta: bigint;
    orderId?: string | null;
  }): Promise<{ balance_after: bigint }>;
  listPointLedger(
    customerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: PointLedgerDTO[]; count: number }>;
  /** 按订单查积分流水（退款退回积分用，ADR-095）。 */
  listPointLedgerByOrder(orderId: string): Promise<PointLedgerDTO[]>;
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
  /** 单张券的范围（后台编辑回填）。 */
  listVoucherScopes(voucherId: string): Promise<VoucherScopeDTO[]>;
  /** 批量取范围（后台列表附上「限 N 个商品/分类」用）。 */
  listVoucherScopesByVoucherIds(voucherIds: string[]): Promise<Record<string, VoucherScopeDTO[]>>;

  // 领券（ADR-029）
  /** 店面可领的店铺券（含当前顾客是否已领、已领几张）。 */
  listPublicVouchers(customerId?: string | null): Promise<PublicVoucherDTO[]>;
  /**
   * 本商品可用的店铺券（商品页领券区，ADR-071）。
   * 整单券与运费券都算可用；指定商品券必须命中本商品或其分类。
   */
  listPublicVouchersForProduct(input: {
    productId: string;
    categoryIds?: string[];
    customerId?: string | null;
  }): Promise<PublicVoucherDTO[]>;
  /** 领取：生成一条专属券码并记领取人。重复领取直接返回已领的码。 */
  collectVoucher(voucherId: string, customerId: string): Promise<{ code: string; alreadyCollected: boolean }>;
  /** 我的卡券（未用在前）。 */
  listCollectedVouchers(customerId: string): Promise<CollectedVoucherDTO[]>;

  // voucher_code
  addVoucherCode(input: CreateVoucherCodeInput): Promise<VoucherCodeDTO>;
  listVoucherCodes(voucherId: string): Promise<VoucherCodeDTO[]>;
  retrieveVoucherCodeByCode(code: string): Promise<VoucherCodeDTO | null>;
  updateVoucherCode(codeId: string, patch: { isActive?: boolean }): Promise<VoucherCodeDTO>;
  deleteVoucherCode(codeId: string): Promise<void>;

  // voucher 核销（阶段 4：下单成功时原子自增 used；超限抛 voucherUsageLimitReached）
  consumeVoucherCodes(codes: string[]): Promise<void>;
  /** workflow 补偿：回退一次 used。 */
  releaseVoucherCodes(codes: string[]): Promise<void>;

  // gift_card
  createGiftCard(input: CreateGiftCardInput): Promise<GiftCardDTO>;
  retrieveGiftCard(id: string): Promise<GiftCardDTO>;
  retrieveGiftCardByCode(code: string): Promise<GiftCardDTO>;
  listGiftCards(q: ListQuery): Promise<{ items: GiftCardDTO[]; count: number }>;
  updateGiftCard(id: string, patch: UpdateGiftCardInput): Promise<GiftCardDTO>;
  deleteGiftCard(id: string): Promise<void>;
  /** 启停礼品卡（写 activated/deactivated 流水）。 */
  setGiftCardActive(id: string, isActive: boolean): Promise<GiftCardDTO>;
  /** 手动调账：正=加余额，负=减余额（原子扣减，不足抛 giftCardInsufficientBalance），写 balance_adjusted 流水。 */
  adjustGiftCardBalance(
    id: string,
    deltaMinor: bigint,
    parameters?: Record<string, unknown> | null,
  ): Promise<GiftCardDTO>;
  /** 下单成功时原子扣减多张礼品卡余额 + 写 used_in_order 流水；余额不足抛 giftCardInsufficientBalance 触发整单回滚。 */
  consumeGiftCards(entries: Array<{ code: string; amountMinor: bigint }>, orderId: string): Promise<void>;
  /** workflow 补偿：加回余额 + 写 refunded_in_order 流水。 */
  releaseGiftCards(entries: Array<{ code: string; amountMinor: bigint }>, orderId: string): Promise<void>;

  /** 下单成功时扣减积分（ADR-094）：余额不足抛错触发整单回滚。 */
  consumePointsForOrder(customerId: string, points: bigint, orderId: string): Promise<void>;
  /** workflow 补偿：退回积分。 */
  releasePointsForOrder(customerId: string, points: bigint, orderId: string): Promise<void>;
  /** 退款时退回积分（ADR-095）：扣回该单发放的、退回该单抵扣的，幂等。 */
  refundPointsForOrder(orderId: string): Promise<void>;

  // gift_card_event
  listGiftCardEvents(giftCardId: string): Promise<GiftCardEventDTO[]>;

  // flash_sale（ADR-099）
  createFlashSale(input: CreateFlashSaleInput): Promise<FlashSaleDTO>;
  listFlashSales(q: {
    status?: FlashSaleStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: FlashSaleDTO[]; count: number }>;
  /** 上架 / 结束：draft→active、active→ended（重复调用幂等返回）。 */
  setFlashSaleStatus(id: string, status: "active" | "ended"): Promise<FlashSaleDTO>;
  /** 店面：进行中的活动（按时间窗与状态过滤，附剩余可售）。 */
  listActiveFlashSales(now?: Date): Promise<FlashSaleDTO[]>;
  /**
   * 下单成功后扣活动库存（ADR-099）：任一商品售罄就抛错，由 workflow 回滚整单。
   */
  consumeFlashStock(entries: Array<{ flashSaleItemId: string; quantity: number }>): Promise<void>;
  /** workflow 补偿：退回活动库存。 */
  releaseFlashStock(entries: Array<{ flashSaleItemId: string; quantity: number }>): Promise<void>;

  // points（ADR-093）
  /** 当前积分余额（点数）。 */
  getPointBalance(customerId: string): Promise<bigint>;
  /**
   * 订单完成发放积分（ADR-093）：按实付金额折算，幂等 —— 同一订单只发一次
   * （unique partial index 兜底，重复调用返回首次那条流水）。
   */
  earnPointsForOrder(customerId: string, orderId: string, paidMinor: bigint): Promise<PointLedgerDTO>;
  /** 积分流水（倒序）。 */
  listPointLedger(
    customerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: PointLedgerDTO[]; count: number }>;

  // 折扣计算（阶段 2-5 落地，阶段 1 占位抛 notImplemented）
  /** 三个功能开关的当前值；未落库的按关闭处理（默认关闭）。 */
  getFeatureFlags(): Promise<Record<MarketingFeature, boolean>>;
  setFeatureEnabled(feature: MarketingFeature, enabled: boolean): Promise<void>;
  computeDiscounts(ctx: ComputeDiscountsInput): Promise<ComputeDiscountsResult>;
}
