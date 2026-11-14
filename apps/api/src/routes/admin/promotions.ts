import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import { PaginationQuerySchema } from "@mall/types";
import {
  voucherCodeAlreadyExists,
  type VoucherCodeDTO,
  type VoucherDTO,
  type GiftCardDTO,
  type GiftCardEventDTO,
  type PromotionDTO,
  type PromotionRuleDTO,
  type PromotionPredicate,
} from "@mall/promotion";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * Admin Voucher 管理（阶段 4，资金安全硬约束 1：钱的配置只能走后台 + RBAC + 审计）。
 * 全部端点 `adminAuth + requirePermission("settings")`。
 * 券码 code：后端生成（48-bit 随机 hex）或管理员指定，唯一性由 DB unique index 兜底。
 */

/** 百分比折扣上限 100%（10000 bps）。后台误配 150% 会把应收折成 0，等同白送（资金安全）。 */
const MAX_PERCENTAGE_BPS = 10000;

/** 折扣值守卫：percentage 不得超过 100%，fixed 不限（但由 computeDiscounts 封顶到应付）。 */
function assertDiscountWithinCap(type: "fixed" | "percentage", value: number, label: string): void {
  if (type === "percentage" && value > MAX_PERCENTAGE_BPS) {
    throw errors.validation(`${label}百分比折扣不得超过 100%（10000 bps）`, {
      max_bps: MAX_PERCENTAGE_BPS,
      got_bps: value,
    });
  }
}

/** 券适用范围（ADR-064）：product=指定商品，category=指定分类。 */
const voucherScopeSchema = z.object({
  scope_type: z.enum(["product", "category"]),
  scope_id: z.string().min(1),
});
const createVoucherBody = z
  .object({
    name: z.string().min(1),
    type: z.enum(["entire_order", "shipping", "specific_product"]).optional(),
    discount_type: z.enum(["fixed", "percentage"]),
    // percentage 为万分比 bps（如 2000=20%），fixed 为 minor unit。金额一律服务端 bigint。
    discount_value: z.number().int().nonnegative(),
    min_spent: z.number().int().nonnegative().nullable().optional(),
    usage_limit: z.number().int().nonnegative().nullable().optional(),
    starts_at: z.string().datetime().nullable().optional(),
    ends_at: z.string().datetime().nullable().optional(),
    // 管理员指定券码；不传则后端生成 1 个高熵码。
    codes: z.array(z.string().min(1)).max(100).optional(),
    /** 店面公开可领（店铺券）；false = 只能凭码使用。 */
    is_public: z.boolean().optional(),
    /** 每人限领张数。 */
    collect_limit: z.number().int().min(1).max(99).optional(),
    /** 领取后 N 天有效（ADR-085）；不传 = 只用固定区间。 */
    valid_days: z.number().int().min(1).max(365).nullable().optional(),
    /** 适用范围：仅 type='specific_product' 时需要。 */
    scopes: z.array(voucherScopeSchema).min(1).max(200).optional(),
  })
  .refine(
    (b) => b.discount_type !== "percentage" || b.discount_value <= MAX_PERCENTAGE_BPS,
    { path: ["discount_value"], message: "百分比折扣不得超过 100%（10000 bps）" },
  )
  .refine(
    // 指定商品券必须说清楚「哪些商品/分类」，否则范围为空会变成一张永远用不了的券
    (b) => b.type !== "specific_product" || (b.scopes !== undefined && b.scopes.length > 0),
    { path: ["scopes"], message: "指定商品券必须至少选择一个商品或分类" },
  );

const updateVoucherBody = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["entire_order", "shipping", "specific_product"]).optional(),
  discount_type: z.enum(["fixed", "percentage"]).optional(),
  discount_value: z.number().int().nonnegative().optional(),
  min_spent: z.number().int().nonnegative().nullable().optional(),
  usage_limit: z.number().int().nonnegative().nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_public: z.boolean().optional(),
  collect_limit: z.number().int().min(1).max(99).optional(),
  valid_days: z.number().int().min(1).max(365).nullable().optional(),
  scopes: z.array(voucherScopeSchema).min(1).max(200).optional(),
});

const addCodesBody = z.object({ codes: z.array(z.string().min(1)).min(1).max(100) });


/** 48-bit 随机高熵券码（hex 大写），唯一性由 voucher_code.code unique index 兜底。 */
function generateVoucherCode(): string {
  return randomBytes(6).toString("hex").toUpperCase();
}

function mapVoucher(v: VoucherDTO) {
  return {
    id: v.id,
    name: v.name,
    type: v.type,
    usage_limit: v.usage_limit,
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    discount_type: v.discount_type,
    discount_value: v.discount_value,
    min_spent: v.min_spent,
    status: v.status,
    is_public: v.is_public,
    collect_limit: v.collect_limit,
  };
}

function mapScope(sc: { scope_type: string; scope_id: string }) {
  return { scope_type: sc.scope_type, scope_id: sc.scope_id };
}

function mapCode(c: VoucherCodeDTO) {
  return {
    id: c.id,
    voucher_id: c.voucher_id,
    code: c.code,
    used: c.used,
    is_active: c.is_active,
  };
}

/** 64-bit 随机高熵礼品卡码（hex 大写），唯一性由 gift_card.code unique index 兜底。 */
function generateGiftCardCode(): string {
  return `GC-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function mapGiftCard(g: GiftCardDTO) {
  return {
    id: g.id,
    code: g.code,
    currency: g.currency,
    initial_balance: g.initial_balance,
    current_balance: g.current_balance,
    is_active: g.is_active,
    expires_at: g.expires_at,
    assigned_to: g.assigned_to,
  };
}

function mapGiftCardEvent(e: GiftCardEventDTO) {
  return {
    id: e.id,
    gift_card_id: e.gift_card_id,
    type: e.type,
    amount: e.amount,
    order_id: e.order_id,
    parameters: e.parameters,
    created_at: e.created_at,
  };
}

const createGiftCardBody = z.object({
  currency: z.string().length(3),
  // 金额一律 minor unit（分），服务端 bigint；初始余额为 int64，正数（0 也不允许，避免发空卡）。
  initial_balance: z.number().int().positive(),
  expires_at: z.string().datetime().nullable().optional(),
  assigned_to: z.string().min(1).nullable().optional(),
});

/** 只允许改有效期与绑定客户；余额/币种/卡码创建后不可改（余额变动走 adjust 调账留痕）。 */
const updateGiftCardBody = z.object({
  expires_at: z.string().datetime().nullable().optional(),
  assigned_to: z.string().min(1).nullable().optional(),
});

const adjustGiftCardBody = z.object({
  // 正=加余额，负=减余额（minor unit）。金额由后台管理员指定，全程服务端 bigint 计算。
  delta_minor: z.number().int(),
  reason: z.string().max(500).optional(),
});

// —— 目录/订单促销（promotion 表）管理（二期补齐，资金安全硬约束 1：促销都要后台可控制）——
function mapPromotion(p: PromotionDTO) {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    type: p.type,
    status: p.status,
    is_automatic: p.is_automatic,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    usage_limit: p.usage_limit,
    used: p.used,
    metadata: p.metadata,
  };
}

function mapPromotionRule(r: PromotionRuleDTO) {
  return {
    id: r.id,
    promotion_id: r.promotion_id,
    predicate: r.predicate,
    reward_type: r.reward_type,
    // percentage 为万分比 bps，fixed 为 minor unit。金额一律服务端 bigint。
    reward_value: r.reward_value,
    allocation: r.allocation,
  };
}

/** 类型化 predicate（ADR-012 §2）：递归校验 and/or 组合 + 叶子谓词，禁客户端传非法结构。 */
const promotionPredicateSchema: z.ZodType<PromotionPredicate> = z.lazy(() =>
  z.union([
    z.object({ and: z.array(promotionPredicateSchema).min(1) }),
    z.object({ or: z.array(promotionPredicateSchema).min(1) }),
    z.object({ variantIds: z.array(z.string().min(1)).min(1) }),
    z.object({ categoryIds: z.array(z.string().min(1)).min(1) }),
    z.object({ collectionIds: z.array(z.string().min(1)).min(1) }),
    z.object({ subtotalGte: z.number().int().nonnegative() }),
    z.object({ currencyEq: z.string().min(1) }),
  ]),
);

const createPromotionRuleBody = z
  .object({
    predicate: promotionPredicateSchema.optional(),
    reward_type: z.enum(["fixed", "percentage"]),
    // percentage 为万分比 bps（如 2000=20%），fixed 为 minor unit。金额一律服务端 bigint。
    reward_value: z.number().int().nonnegative(),
    allocation: z.enum(["each", "across", "once"]).nullable().optional(),
  })
  .refine((b) => b.reward_type !== "percentage" || b.reward_value <= MAX_PERCENTAGE_BPS, {
    path: ["reward_value"],
    message: "百分比折扣不得超过 100%（10000 bps）",
  });

const createPromotionBody = z.object({
  name: z.string().min(1),
  code: z.string().min(1).nullable().optional(),
  type: z.enum(["catalogue", "order"]),
  status: z.enum(["draft", "active", "inactive"]).optional(),
  is_automatic: z.boolean().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  usage_limit: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  // 创建时可选附带规则（与 addPromotionRule 同构，缺 promotionId）。
  rules: z.array(createPromotionRuleBody).max(100).optional(),
});

const updatePromotionBody = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).nullable().optional(),
  type: z.enum(["catalogue", "order"]).optional(),
  status: z.enum(["draft", "active", "inactive"]).optional(),
  is_automatic: z.boolean().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  usage_limit: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const listPromotionsQuery = PaginationQuerySchema.extend({
  type: z.enum(["catalogue", "order"]).optional(),
  status: z.enum(["draft", "active", "inactive"]).optional(),
  q: z.string().min(1).max(80).optional(),
});

/** 优惠券 / 礼品卡的列表查询：分页 + 关键字（券按名称、卡按卡号）。 */
const listSearchQuery = PaginationQuerySchema.extend({
  q: z.string().min(1).max(80).optional(),
});

export function adminPromotionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  // —— 营销功能级开关（默认全关；每个功能在自己的菜单页打开）——
  app.get("/api/v1/admin/promotions/features", { preHandler: guard }, async (_req, reply) => {
    reply.ok(await deps.services.promotion.getFeatureFlags());
  });

  app.put(
    "/api/v1/admin/promotions/features/:feature",
    {
      preHandler: guard,
      schema: { body: z.object({ enabled: z.boolean() }) },
    },
    async (req, reply) => {
      const { feature } = req.params as { feature: string };
      const parsed = z.enum(["promotion", "voucher", "gift_card"]).safeParse(feature);
      if (!parsed.success) throw errors.validation("未知的营销功能", { feature });
      const b = req.body as { enabled: boolean };
      const before = await deps.services.promotion.getFeatureFlags();
      await deps.services.promotion.setFeatureEnabled(parsed.data, b.enabled);
      const after = await deps.services.promotion.getFeatureFlags();
      await deps.audit.record(
        auditEntry(req, {
          action: "promotion.feature.update",
          entityType: "promotion_feature",
          entityId: parsed.data,
          before,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  // —— 目录/订单促销（promotion 表）CRUD + 启停 + 规则（二期补齐，RBAC + 审计）——

  app.get(
    "/api/v1/admin/promotions",
    { preHandler: guard, schema: { querystring: listPromotionsQuery } },
    async (req, reply) => {
      const q = req.query as {
        limit: number;
        offset: number;
        type?: "catalogue" | "order";
        status?: "draft" | "active" | "inactive";
        q?: string;
      };
      /*
       * 筛选必须在 SQL 里：之前 type/status 是「拉 MAX_PAGE_OFFSET 条再内存过滤」，
       * 活动超过一页时第二页起永远拿不到（与 ADR-031 后台订单列表同一个坑）。
       */
      const res = await deps.services.promotion.listPromotions({
        limit: q.limit,
        offset: q.offset,
        ...(q.type ? { type: q.type } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.q ? { q: q.q } : {}),
      });
      const items = res.items;
      const count = res.count;
      reply.ok({
        items: items.map(mapPromotion),
        count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + items.length < count,
      });
    },
  );

  app.post(
    "/api/v1/admin/promotions",
    { preHandler: guard, schema: { body: createPromotionBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createPromotionBody>;
      const promotion = await deps.services.promotion.createPromotion({
        name: b.name,
        code: b.code ?? null,
        type: b.type,
        status: b.status,
        isAutomatic: b.is_automatic,
        startsAt: b.starts_at !== undefined ? (b.starts_at ? new Date(b.starts_at) : null) : undefined,
        endsAt: b.ends_at !== undefined ? (b.ends_at ? new Date(b.ends_at) : null) : undefined,
        usageLimit: b.usage_limit,
        metadata: b.metadata,
      });
      const rules: PromotionRuleDTO[] = [];
      for (const r of b.rules ?? []) {
        rules.push(
          await deps.services.promotion.addPromotionRule({
            promotionId: promotion.id,
            predicate: r.predicate,
            rewardType: r.reward_type,
            rewardValue: BigInt(r.reward_value),
            allocation: r.allocation ?? null,
          }),
        );
      }
      await deps.audit.record(
        auditEntry(req, {
          action: "promotion.create",
          entityType: "promotion",
          entityId: promotion.id,
          after: { ...mapPromotion(promotion), rules: rules.map(mapPromotionRule) },
        }),
      );
      reply.code(201).ok({ ...mapPromotion(promotion), rules: rules.map(mapPromotionRule) });
    },
  );

  app.get("/api/v1/admin/promotions/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const promotion = await deps.services.promotion.retrievePromotion(id);
    const rules = await deps.services.promotion.listPromotionRules(id);
    reply.ok({ ...mapPromotion(promotion), rules: rules.map(mapPromotionRule) });
  });

  app.put(
    "/api/v1/admin/promotions/:id",
    { preHandler: guard, schema: { body: updatePromotionBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updatePromotionBody>;
      const before = await deps.services.promotion.retrievePromotion(id);
      const updated = await deps.services.promotion.updatePromotion(id, {
        name: b.name,
        code: b.code,
        type: b.type,
        status: b.status,
        isAutomatic: b.is_automatic,
        startsAt: b.starts_at !== undefined ? (b.starts_at ? new Date(b.starts_at) : null) : undefined,
        endsAt: b.ends_at !== undefined ? (b.ends_at ? new Date(b.ends_at) : null) : undefined,
        usageLimit: b.usage_limit,
        metadata: b.metadata,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "promotion.update",
          entityType: "promotion",
          entityId: id,
          before: mapPromotion(before),
          after: mapPromotion(updated),
        }),
      );
      reply.ok(mapPromotion(updated));
    },
  );

  app.delete("/api/v1/admin/promotions/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await deps.services.promotion.retrievePromotion(id);
    await deps.services.promotion.deletePromotion(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "promotion.delete",
        entityType: "promotion",
        entityId: id,
        before: mapPromotion(before),
      }),
    );
    reply.code(204).send();
  });

  // —— 启停（即时生效，硬约束 6：停用后下次 computeDiscounts 立即不命中）——
  app.post("/api/v1/admin/promotions/:id/activate", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await deps.services.promotion.retrievePromotion(id);
    const updated = await deps.services.promotion.updatePromotion(id, { status: "active" });
    await deps.audit.record(
      auditEntry(req, {
        action: "promotion.activate",
        entityType: "promotion",
        entityId: id,
        before: mapPromotion(before),
        after: mapPromotion(updated),
      }),
    );
    reply.ok(mapPromotion(updated));
  });

  app.post("/api/v1/admin/promotions/:id/deactivate", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await deps.services.promotion.retrievePromotion(id);
    const updated = await deps.services.promotion.updatePromotion(id, { status: "inactive" });
    await deps.audit.record(
      auditEntry(req, {
        action: "promotion.deactivate",
        entityType: "promotion",
        entityId: id,
        before: mapPromotion(before),
        after: mapPromotion(updated),
      }),
    );
    reply.ok(mapPromotion(updated));
  });

  // —— 规则管理（一促销多规则）——
  app.post(
    "/api/v1/admin/promotions/:id/rules",
    { preHandler: guard, schema: { body: createPromotionRuleBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof createPromotionRuleBody>;
      const rule = await deps.services.promotion.addPromotionRule({
        promotionId: id,
        predicate: b.predicate,
        rewardType: b.reward_type,
        rewardValue: BigInt(b.reward_value),
        allocation: b.allocation ?? null,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "promotion_rule.create",
          entityType: "promotion_rule",
          entityId: rule.id,
          after: mapPromotionRule(rule),
        }),
      );
      reply.code(201).ok(mapPromotionRule(rule));
    },
  );

  app.delete(
    "/api/v1/admin/promotions/rules/:ruleId",
    { preHandler: guard },
    async (req, reply) => {
      const { ruleId } = req.params as { ruleId: string };
      await deps.services.promotion.deletePromotionRule(ruleId);
      await deps.audit.record(
        auditEntry(req, {
          action: "promotion_rule.delete",
          entityType: "promotion_rule",
          entityId: ruleId,
          before: { rule_id: ruleId },
        }),
      );
      reply.code(204).send();
    },
  );

  // —— Voucher CRUD ——
  app.get(
    "/api/v1/admin/promotions/vouchers",
    { preHandler: guard, schema: { querystring: listSearchQuery } },
    async (req, reply) => {
      const q = req.query as { limit: number; offset: number; q?: string };
      const res = await deps.services.promotion.listVouchers({
        limit: q.limit,
        offset: q.offset,
        ...(q.q ? { q: q.q } : {}),
      });
      // 范围按页内 voucherId 一次取全（一页 20 张只多一条查询）
      const scopesByVoucher = await deps.services.promotion.listVoucherScopesByVoucherIds(
        res.items.map((v) => v.id),
      );
      reply.ok({
        items: res.items.map((v) => ({
          ...mapVoucher(v),
          scopes: (scopesByVoucher[v.id] ?? []).map(mapScope),
        })),
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  app.post(
    "/api/v1/admin/promotions/vouchers",
    { preHandler: guard, schema: { body: createVoucherBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createVoucherBody>;
      const voucher = await deps.services.promotion.createVoucher({
        name: b.name,
        type: b.type,
        discountType: b.discount_type,
        discountValue: BigInt(b.discount_value),
        minSpent: b.min_spent !== undefined ? (b.min_spent === null ? null : BigInt(b.min_spent)) : undefined,
        usageLimit: b.usage_limit,
        startsAt: b.starts_at ? new Date(b.starts_at) : b.starts_at === null ? null : undefined,
        endsAt: b.ends_at ? new Date(b.ends_at) : b.ends_at === null ? null : undefined,
        isPublic: b.is_public,
        collectLimit: b.collect_limit,
        validDays: b.valid_days ?? null,
        ...(b.scopes ? { scopes: b.scopes.map((sc) => ({ scopeType: sc.scope_type, scopeId: sc.scope_id })) } : {}),
      });
      const codes = b.codes && b.codes.length > 0 ? b.codes : [generateVoucherCode()];
      for (const code of codes) {
        if (await deps.services.promotion.retrieveVoucherCodeByCode(code)) {
          throw voucherCodeAlreadyExists(code);
        }
        await deps.services.promotion.addVoucherCode({ voucherId: voucher.id, code });
      }
      const createdCodes = await deps.services.promotion.listVoucherCodes(voucher.id);
      await deps.audit.record(
        auditEntry(req, {
          action: "voucher.create",
          entityType: "voucher",
          entityId: voucher.id,
          after: { ...mapVoucher(voucher), codes: createdCodes.map(mapCode) },
        }),
      );
      reply.code(201).ok({
        ...mapVoucher(voucher),
        codes: createdCodes.map(mapCode),
        scopes: (await deps.services.promotion.listVoucherScopes(voucher.id)).map(mapScope),
      });
    },
  );

  app.get("/api/v1/admin/promotions/vouchers/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const voucher = await deps.services.promotion.retrieveVoucher(id);
    const codes = await deps.services.promotion.listVoucherCodes(id);
    const scopes = await deps.services.promotion.listVoucherScopes(id);
    reply.ok({ ...mapVoucher(voucher), codes: codes.map(mapCode), scopes: scopes.map(mapScope) });
  });

  app.put(
    "/api/v1/admin/promotions/vouchers/:id",
    { preHandler: guard, schema: { body: updateVoucherBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updateVoucherBody>;
      const before = await deps.services.promotion.retrieveVoucher(id);
      // 交叉校验：只改 value 不改 type 时，仍要按现有类型卡 100% 上限（资金安全）。
      assertDiscountWithinCap(
        b.discount_type ?? before.discount_type,
        b.discount_value ?? Number(before.discount_value),
        "优惠券",
      );
      // 改成指定商品券时，必须给出范围（或原本就有范围），否则这张券永远用不了
      const resultingType = b.type ?? before.type;
      if (resultingType === "specific_product" && b.scopes === undefined) {
        const existing = await deps.services.promotion.listVoucherScopes(id);
        if (existing.length === 0) {
          throw errors.validation("指定商品券必须至少选择一个商品或分类");
        }
      }
      const updated = await deps.services.promotion.updateVoucher(id, {
        name: b.name,
        type: b.type,
        discountType: b.discount_type,
        discountValue: b.discount_value !== undefined ? BigInt(b.discount_value) : undefined,
        minSpent: b.min_spent !== undefined ? (b.min_spent === null ? null : BigInt(b.min_spent)) : undefined,
        usageLimit: b.usage_limit,
        startsAt: b.starts_at !== undefined ? (b.starts_at ? new Date(b.starts_at) : null) : undefined,
        endsAt: b.ends_at !== undefined ? (b.ends_at ? new Date(b.ends_at) : null) : undefined,
        isPublic: b.is_public,
        collectLimit: b.collect_limit,
        validDays: b.valid_days ?? null,
        ...(b.scopes !== undefined
          ? { scopes: b.scopes.map((sc) => ({ scopeType: sc.scope_type, scopeId: sc.scope_id })) }
          : {}),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "voucher.update",
          entityType: "voucher",
          entityId: id,
          before: mapVoucher(before),
          after: mapVoucher(updated),
        }),
      );
      reply.ok(mapVoucher(updated));
    },
  );

  // —— 启停（即时生效，硬约束 6：停用后下次 computeDiscounts 立即不命中）——
  app.post("/api/v1/admin/promotions/vouchers/:id/disable", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await deps.services.promotion.retrieveVoucher(id);
    const updated = await deps.services.promotion.updateVoucher(id, { status: "disabled" });
    await deps.audit.record(
      auditEntry(req, {
        action: "voucher.disable",
        entityType: "voucher",
        entityId: id,
        before: mapVoucher(before),
        after: mapVoucher(updated),
      }),
    );
    reply.ok(mapVoucher(updated));
  });

  app.post("/api/v1/admin/promotions/vouchers/:id/enable", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await deps.services.promotion.retrieveVoucher(id);
    const updated = await deps.services.promotion.updateVoucher(id, { status: "active" });
    await deps.audit.record(
      auditEntry(req, {
        action: "voucher.enable",
        entityType: "voucher",
        entityId: id,
        before: mapVoucher(before),
        after: mapVoucher(updated),
      }),
    );
    reply.ok(mapVoucher(updated));
  });

  // —— 券码管理（一券多码，每码独立计数）——
  app.get("/api/v1/admin/promotions/vouchers/:id/codes", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deps.services.promotion.retrieveVoucher(id);
    const codes = await deps.services.promotion.listVoucherCodes(id);
    reply.ok({ items: codes.map(mapCode), count: codes.length });
  });

  app.post(
    "/api/v1/admin/promotions/vouchers/:id/codes",
    { preHandler: guard, schema: { body: addCodesBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof addCodesBody>;
      await deps.services.promotion.retrieveVoucher(id);
      const added: VoucherCodeDTO[] = [];
      for (const code of b.codes) {
        if (await deps.services.promotion.retrieveVoucherCodeByCode(code)) {
          throw voucherCodeAlreadyExists(code);
        }
        added.push(await deps.services.promotion.addVoucherCode({ voucherId: id, code }));
      }
      await deps.audit.record(
        auditEntry(req, {
          action: "voucher_code.create",
          entityType: "voucher_code",
          entityId: id,
          after: added.map(mapCode),
        }),
      );
      reply.code(201).ok({ items: added.map(mapCode) });
    },
  );

  app.delete(
    "/api/v1/admin/promotions/vouchers/:id/codes/:codeId",
    { preHandler: guard },
    async (req, reply) => {
      const { id, codeId } = req.params as { id: string; codeId: string };
      await deps.services.promotion.retrieveVoucher(id);
      await deps.services.promotion.deleteVoucherCode(codeId);
      await deps.audit.record(
        auditEntry(req, {
          action: "voucher_code.delete",
          entityType: "voucher_code",
          entityId: codeId,
          before: { voucher_id: id, code_id: codeId },
        }),
      );
      reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/admin/promotions/vouchers/:id/codes/:codeId/disable",
    { preHandler: guard },
    async (req, reply) => {
      const { id, codeId } = req.params as { id: string; codeId: string };
      await deps.services.promotion.retrieveVoucher(id);
      const updated = await deps.services.promotion.updateVoucherCode(codeId, { isActive: false });
      await deps.audit.record(
        auditEntry(req, {
          action: "voucher_code.disable",
          entityType: "voucher_code",
          entityId: codeId,
          before: { voucher_id: id, code_id: codeId },
          after: mapCode(updated),
        }),
      );
      reply.ok(mapCode(updated));
    },
  );

  app.post(
    "/api/v1/admin/promotions/vouchers/:id/codes/:codeId/enable",
    { preHandler: guard },
    async (req, reply) => {
      const { id, codeId } = req.params as { id: string; codeId: string };
      await deps.services.promotion.retrieveVoucher(id);
      const updated = await deps.services.promotion.updateVoucherCode(codeId, { isActive: true });
      await deps.audit.record(
        auditEntry(req, {
          action: "voucher_code.enable",
          entityType: "voucher_code",
          entityId: codeId,
          before: { voucher_id: id, code_id: codeId },
          after: mapCode(updated),
        }),
      );
      reply.ok(mapCode(updated));
    },
  );

  // 校验券码是否存在（供后台预览/排障，不泄露金额）。
  app.get(
    "/api/v1/admin/promotions/voucher-codes/:code",
    { preHandler: guard },
    async (req, reply) => {
      const { code } = req.params as { code: string };
      const vc = await deps.services.promotion.retrieveVoucherCodeByCode(code);
      if (!vc) throw errors.notFound("券码不存在");
      reply.ok(mapCode(vc));
    },
  );

  // —— Gift Card 管理（阶段 5，资金安全硬约束 1/5：钱的配置只能走后端 + 后台，RBAC + 审计）——
  app.get(
    "/api/v1/admin/promotions/gift-cards",
    { preHandler: guard, schema: { querystring: listSearchQuery } },
    async (req, reply) => {
      const q = req.query as { limit: number; offset: number; q?: string };
      const res = await deps.services.promotion.listGiftCards({
        limit: q.limit,
        offset: q.offset,
        ...(q.q ? { q: q.q } : {}),
      });
      reply.ok({
        items: res.items.map(mapGiftCard),
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  app.post(
    "/api/v1/admin/promotions/gift-cards",
    { preHandler: guard, schema: { body: createGiftCardBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof createGiftCardBody>;
      const card = await deps.services.promotion.createGiftCard({
        code: generateGiftCardCode(),
        currency: b.currency,
        initialBalance: BigInt(b.initial_balance),
        expiresAt: b.expires_at ? new Date(b.expires_at) : b.expires_at === null ? null : undefined,
        assignedTo: b.assigned_to !== undefined ? b.assigned_to : undefined,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "gift_card.create",
          entityType: "gift_card",
          entityId: card.id,
          after: mapGiftCard(card),
        }),
      );
      reply.code(201).ok(mapGiftCard(card));
    },
  );

  app.get("/api/v1/admin/promotions/gift-cards/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = await deps.services.promotion.retrieveGiftCard(id);
    reply.ok(mapGiftCard(card));
  });

  app.put(
    "/api/v1/admin/promotions/gift-cards/:id",
    { preHandler: guard, schema: { body: updateGiftCardBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updateGiftCardBody>;
      const before = await deps.services.promotion.retrieveGiftCard(id);
      const updated = await deps.services.promotion.updateGiftCard(id, {
        expiresAt: b.expires_at !== undefined ? (b.expires_at ? new Date(b.expires_at) : null) : undefined,
        assignedTo: b.assigned_to !== undefined ? b.assigned_to : undefined,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "gift_card.update",
          entityType: "gift_card",
          entityId: id,
          before: mapGiftCard(before),
          after: mapGiftCard(updated),
        }),
      );
      reply.ok(mapGiftCard(updated));
    },
  );

  // 启停（即时生效，硬约束 6：停用后下次 computeDiscounts 立即不命中），写 activated/deactivated 流水。
  app.post(
    "/api/v1/admin/promotions/gift-cards/:id/disable",
    { preHandler: guard },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const before = await deps.services.promotion.retrieveGiftCard(id);
      const updated = await deps.services.promotion.setGiftCardActive(id, false);
      await deps.audit.record(
        auditEntry(req, {
          action: "gift_card.disable",
          entityType: "gift_card",
          entityId: id,
          before: mapGiftCard(before),
          after: mapGiftCard(updated),
        }),
      );
      reply.ok(mapGiftCard(updated));
    },
  );

  app.post(
    "/api/v1/admin/promotions/gift-cards/:id/enable",
    { preHandler: guard },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const before = await deps.services.promotion.retrieveGiftCard(id);
      const updated = await deps.services.promotion.setGiftCardActive(id, true);
      await deps.audit.record(
        auditEntry(req, {
          action: "gift_card.enable",
          entityType: "gift_card",
          entityId: id,
          before: mapGiftCard(before),
          after: mapGiftCard(updated),
        }),
      );
      reply.ok(mapGiftCard(updated));
    },
  );

  // 手动调账：加/减余额，写 balance_adjusted 流水（余额非负由 DB CHECK + 原子扣减兜底）。
  app.post(
    "/api/v1/admin/promotions/gift-cards/:id/adjust",
    { preHandler: guard, schema: { body: adjustGiftCardBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof adjustGiftCardBody>;
      const before = await deps.services.promotion.retrieveGiftCard(id);
      const updated = await deps.services.promotion.adjustGiftCardBalance(id, BigInt(b.delta_minor), {
        reason: b.reason ?? null,
        operator: req.auth?.sub ?? null,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "gift_card.adjust",
          entityType: "gift_card",
          entityId: id,
          before: mapGiftCard(before),
          after: mapGiftCard(updated),
        }),
      );
      reply.ok(mapGiftCard(updated));
    },
  );

  // 流水账本（只追加，current_balance 是流水汇总缓存，硬约束 6）。
  app.get(
    "/api/v1/admin/promotions/gift-cards/:id/events",
    { preHandler: guard },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await deps.services.promotion.retrieveGiftCard(id);
      const events = await deps.services.promotion.listGiftCardEvents(id);
      reply.ok({ items: events.map(mapGiftCardEvent), count: events.length });
    },
  );
}
