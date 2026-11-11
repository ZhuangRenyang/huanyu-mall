import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/**
 * 税务配置（ADR-018）。
 *
 * 用户要求「没有实际地区，看用户选择，最好可以切换调整」——
 * 所以这里给的是：**一个总开关 + 一个默认税率 + 一张国家→税率覆盖表**。
 * 顾客在结账选了国家就用对应税率，没配的国家回落默认。
 *
 * 权限：settings（与其它店铺配置同权）。全部写审计。
 */
const settingsBody = z.object({
  enabled: z.boolean().optional(),
  tax_name: z.string().min(1).max(40).optional(),
  prices_include_tax: z.boolean().optional(),
});

const rateBody = z.object({
  name: z.string().min(1).max(60),
  /** 万分比：1300 = 13%。 */
  rate_bps: z.number().int().min(0).max(10000),
});

export function adminTaxRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];
  const tax = () => deps.services.tax;

  /** 一次性给全：设置 + 默认税率 + 各国覆盖，界面一次拿完。 */
  app.get("/api/v1/admin/tax", { preHandler: guard }, async (_req, reply) => {
    const [settings, rates] = await Promise.all([tax().getSettings(), tax().listRates()]);
    reply.ok({
      settings,
      default_rate: rates.find((r) => r.country_code === null) ?? null,
      country_rates: rates.filter((r) => r.country_code !== null),
    });
  });

  app.put(
    "/api/v1/admin/tax/settings",
    { preHandler: guard, schema: { body: settingsBody } },
    async (req, reply) => {
      const before = await tax().getSettings();
      const after = await tax().updateSettings(req.body as z.infer<typeof settingsBody>);
      await deps.audit.record(
        auditEntry(req, {
          action: "tax.settings.update",
          entityType: "tax_settings",
          entityId: "tax_default",
          before,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  app.put(
    "/api/v1/admin/tax/default-rate",
    { preHandler: guard, schema: { body: rateBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof rateBody>;
      const before = (await tax().listRates()).find((r) => r.country_code === null) ?? null;
      const after = await tax().setDefaultRate({ name: body.name, rateBps: body.rate_bps });
      await deps.audit.record(
        auditEntry(req, {
          action: "tax.default_rate.update",
          entityType: "tax_rate",
          entityId: after.id,
          before,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  app.put(
    "/api/v1/admin/tax/country-rates/:code",
    { preHandler: guard, schema: { body: rateBody } },
    async (req, reply) => {
      const { code } = req.params as { code: string };
      const body = req.body as z.infer<typeof rateBody>;
      const before = await tax().listRates();
      const after = await tax().setCountryRate({
        countryCode: code,
        name: body.name,
        rateBps: body.rate_bps,
      });
      await deps.audit.record(
        auditEntry(req, {
          action: "tax.country_rate.update",
          entityType: "tax_rate",
          entityId: after.id,
          before: before.find((r) => r.country_code === after.country_code) ?? null,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  app.delete("/api/v1/admin/tax/country-rates/:code", { preHandler: guard }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const before = await tax().listRates();
    await tax().deleteCountryRate(code);
    await deps.audit.record(
      auditEntry(req, {
        action: "tax.country_rate.delete",
        entityType: "tax_rate",
        entityId: code.toUpperCase(),
        before: before.find((r) => r.country_code === code.toUpperCase()) ?? null,
      }),
    );
    reply.ok({ ok: true });
  });
}
