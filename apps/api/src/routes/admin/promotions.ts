import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import { PaginationQuerySchema } from "@mall/types";
import { voucherCodeAlreadyExists, type VoucherCodeDTO, type VoucherDTO } from "@mall/promotion";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * Admin Voucher 管理（阶段 4，资金安全硬约束 1：钱的配置只能走后台 + RBAC + 审计）。
 * 全部端点 `adminAuth + requirePermission("settings")`。
 * 券码 code：后端生成（48-bit 随机 hex）或管理员指定，唯一性由 DB unique index 兜底。
 */

const createVoucherBody = z.object({
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
});

const updateVoucherBody = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["entire_order", "shipping", "specific_product"]).optional(),
  discount_type: z.enum(["fixed", "percentage"]).optional(),
  discount_value: z.number().int().nonnegative().optional(),
  min_spent: z.number().int().nonnegative().nullable().optional(),
  usage_limit: z.number().int().nonnegative().nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
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
  };
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

export function adminPromotionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  // —— Voucher CRUD ——
  app.get(
    "/api/v1/admin/promotions/vouchers",
    { preHandler: guard, schema: { querystring: PaginationQuerySchema } },
    async (req, reply) => {
      const q = req.query as { limit: number; offset: number };
      const res = await deps.services.promotion.listVouchers({ limit: q.limit, offset: q.offset });
      reply.ok({
        items: res.items.map(mapVoucher),
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
      reply.code(201).ok({ ...mapVoucher(voucher), codes: createdCodes.map(mapCode) });
    },
  );

  app.get("/api/v1/admin/promotions/vouchers/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const voucher = await deps.services.promotion.retrieveVoucher(id);
    const codes = await deps.services.promotion.listVoucherCodes(id);
    reply.ok({ ...mapVoucher(voucher), codes: codes.map(mapCode) });
  });

  app.put(
    "/api/v1/admin/promotions/vouchers/:id",
    { preHandler: guard, schema: { body: updateVoucherBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof updateVoucherBody>;
      const before = await deps.services.promotion.retrieveVoucher(id);
      const updated = await deps.services.promotion.updateVoucher(id, {
        name: b.name,
        type: b.type,
        discountType: b.discount_type,
        discountValue: b.discount_value !== undefined ? BigInt(b.discount_value) : undefined,
        minSpent: b.min_spent !== undefined ? (b.min_spent === null ? null : BigInt(b.min_spent)) : undefined,
        usageLimit: b.usage_limit,
        startsAt: b.starts_at !== undefined ? (b.starts_at ? new Date(b.starts_at) : null) : undefined,
        endsAt: b.ends_at !== undefined ? (b.ends_at ? new Date(b.ends_at) : null) : undefined,
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
}
