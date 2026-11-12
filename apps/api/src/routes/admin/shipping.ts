import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 运费设置（ADR-019 的落地入口）。
 *
 * 模型照抄成熟电商（Shopify / WooCommerce / Medusa 三家一致）：
 *   **发货区（按国家）→ 区内运费方式（固定价 / 满额包邮）**
 *
 * 为什么不在商品详情放「包邮」开关：
 *   一件商品在多个国家、多档门槛下没有唯一运费，商品级开关只会造出
 *   第二套与发货区打架的口径 —— 那正是「可绕过」的来源。
 *
 * 商家能改的只有三件事：哪些国家（区）、多少钱（方式）、满多少免运费（门槛）。
 * 结账端全自动：按收货国家找区 → 区内启用方式 → 按小计判门槛，无需选择。
 *
 * 权限：settings（与税务、支付等店铺配置同权）。全部写审计。
 */
const profileBody = z.object({ name: z.string().min(1).max(60) });

const zoneBody = z.object({
  name: z.string().min(1).max(60),
  country_codes: z.array(z.string().length(2)).min(1).max(300),
  /** 所属运费模板；不传用默认模板。 */
  profile_id: z.string().nullable().optional(),
});

const zonePatchBody = z.object({
  name: z.string().min(1).max(60).optional(),
  country_codes: z.array(z.string().length(2)).min(1).max(300).optional(),
});

const optionBody = z.object({
  zone_id: z.string().min(1),
  name: z.string().min(1).max(60),
  carrier: z.string().max(60).nullable().optional(),
  type: z.enum(["flat", "free_over"]),
  amount_minor: z.number().int().nonnegative(),
  /** 仅 free_over 有意义：满多少免运费（minor）。 */
  free_over_threshold_minor: z.number().int().positive().nullable().optional(),
});

const optionPatchBody = z.object({
  name: z.string().min(1).max(60).optional(),
  carrier: z.string().max(60).nullable().optional(),
  type: z.enum(["flat", "free_over"]).optional(),
  amount_minor: z.number().int().nonnegative().optional(),
  free_over_threshold_minor: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
});

export function adminShippingRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];
  const shipping = () => deps.services.fulfillment;

  /**
   * 一次性给全：所有发货区 + 区内运费方式 + 可选国家 + 币种。
   *
   * 后台页面只有这一屏，分多次请求只会让「保存到一半」的中间态暴露给商家。
   */
  app.get("/api/v1/admin/shipping", { preHandler: guard }, async (_req, reply) => {
    const [profiles, zones] = await Promise.all([
      shipping().listShippingProfiles(),
      shipping().listShippingZones(),
    ]);
    const withOptions = await Promise.all(
      zones.map(async (zone) => ({
        ...zone,
        options: await shipping().listShippingOptionsByZone(zone.id),
      })),
    );
    const [countries, channels] = await Promise.all([
      deps.services.tax.listCheckoutCountries(),
      deps.services.regionChannel.listChannels({ isActive: true }),
    ]);
    reply.ok({
      profiles,
      zones: withOptions,
      /** 结账可选国家（带税率的同一份清单，后台选国家不用手打代码）。 */
      countries: countries.map((c) => ({ code: c.code, name: c.name })),
      currency_code: channels[0]?.currency_code ?? "CNY",
    });
  });

  app.post(
    "/api/v1/admin/shipping/profiles",
    { preHandler: guard, schema: { body: profileBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof profileBody>;
      const profile = await shipping().createShippingProfile({ name: body.name });
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.profile.create",
          entityType: "shipping_profile",
          entityId: profile.id,
          after: profile,
        }),
      );
      reply.ok(profile);
    },
  );

  app.patch(
    "/api/v1/admin/shipping/profiles/:id",
    { preHandler: guard, schema: { body: profileBody.partial() } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<ReturnType<typeof profileBody.partial>>;
      const before = (await shipping().listShippingProfiles()).find((p) => p.id === id) ?? null;
      const profile = await shipping().updateShippingProfile(id, { name: body.name });
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.profile.update",
          entityType: "shipping_profile",
          entityId: id,
          before,
          after: profile,
        }),
      );
      reply.ok(profile);
    },
  );

  app.delete(
    "/api/v1/admin/shipping/profiles/:id",
    { preHandler: guard },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const before = (await shipping().listShippingProfiles()).find((p) => p.id === id) ?? null;
      await shipping().deleteShippingProfile(id);
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.profile.delete",
          entityType: "shipping_profile",
          entityId: id,
          before,
        }),
      );
      reply.ok({ ok: true });
    },
  );

  app.post(
    "/api/v1/admin/shipping/zones",
    { preHandler: guard, schema: { body: zoneBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof zoneBody>;
      const zone = await shipping().createShippingZone({
        name: body.name,
        countryCodes: body.country_codes,
        profileId: body.profile_id ?? null,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.zone.create",
          entityType: "shipping_zone",
          entityId: zone.id,
          after: zone,
        }),
      );
      reply.ok(zone);
    },
  );

  app.patch(
    "/api/v1/admin/shipping/zones/:id",
    { preHandler: guard, schema: { body: zonePatchBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof zonePatchBody>;
      const before = (await shipping().listShippingZones()).find((z) => z.id === id) ?? null;
      const zone = await shipping().updateShippingZone(id, {
        name: body.name,
        countryCodes: body.country_codes,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.zone.update",
          entityType: "shipping_zone",
          entityId: id,
          before,
          after: zone,
        }),
      );
      reply.ok(zone);
    },
  );

  app.delete(
    "/api/v1/admin/shipping/zones/:id",
    { preHandler: guard },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const before = (await shipping().listShippingZones()).find((z) => z.id === id) ?? null;
      await shipping().deleteShippingZone(id);
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.zone.delete",
          entityType: "shipping_zone",
          entityId: id,
          before,
        }),
      );
      reply.ok({ ok: true });
    },
  );

  app.post(
    "/api/v1/admin/shipping/options",
    { preHandler: guard, schema: { body: optionBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof optionBody>;
      const channels = await deps.services.regionChannel.listChannels({ isActive: true });
      if (channels.length === 0) {
        // 没有启用渠道就没有销售通路，运费配了也没人用得上 —— 直接报错，不静默落库。
        return reply.code(409).send({
          code: 30002,
          data: null,
          message: "当前没有启用的销售渠道，请先在区域与渠道中启用",
          requestId: req.id,
        });
      }
      const option = await shipping().createShippingOption({
        zoneId: body.zone_id,
        name: body.name,
        carrier: body.carrier ?? null,
        type: body.type,
        amountMinor: BigInt(body.amount_minor),
        currencyCode: channels[0]!.currency_code,
        freeOverThresholdMinor:
          body.free_over_threshold_minor == null ? null : BigInt(body.free_over_threshold_minor),
        // 后台不暴露「渠道」概念：运费区按国家划分，对当前所有启用渠道都生效。
        channelIds: channels.map((c) => c.id),
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.option.create",
          entityType: "shipping_option",
          entityId: option.id,
          after: option,
        }),
      );
      reply.ok(option);
    },
  );

  app.patch(
    "/api/v1/admin/shipping/options/:id",
    { preHandler: guard, schema: { body: optionPatchBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof optionPatchBody>;
      const before = await shipping().findShippingOption(id);
      const option = await shipping().updateShippingOption(id, {
        name: body.name,
        carrier: body.carrier,
        type: body.type,
        amountMinor: body.amount_minor === undefined ? undefined : BigInt(body.amount_minor),
        freeOverThresholdMinor:
          body.free_over_threshold_minor === undefined
            ? undefined
            : body.free_over_threshold_minor === null
              ? null
              : BigInt(body.free_over_threshold_minor),
        isActive: body.is_active,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.option.update",
          entityType: "shipping_option",
          entityId: id,
          before,
          after: option,
        }),
      );
      reply.ok(option);
    },
  );

  app.delete(
    "/api/v1/admin/shipping/options/:id",
    { preHandler: guard },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const before = await shipping().findShippingOption(id);
      await shipping().deleteShippingOption(id);
      await deps.audit.record(
        auditEntry(req, {
          action: "shipping.option.delete",
          entityType: "shipping_option",
          entityId: id,
          before,
        }),
      );
      reply.ok({ ok: true });
    },
  );
}
