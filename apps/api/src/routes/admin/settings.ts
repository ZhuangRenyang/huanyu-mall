import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ThemeSettingsDTO } from "@mall/theme";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

const patchSettingsBody = z.record(z.string(), z.unknown());
const themeBody = z.object({
  primary_color: z.string().optional(),
  gradient_color: z.string().optional(),
  accent_color: z.string().optional(),
  font_family: z.string().optional(),
  border_radius: z.string().optional(),
  shadow: z.string().optional(),
  logo_file_id: z.string().nullable().optional(),
  product_image_ratio: z.string().optional(),
});
const providerConfigBody = z.object({
  options: z.record(z.string(), z.unknown()),
  enabled_channels: z.array(z.string()).optional(),
});

/**
 * 顾客账号设置（ADR-025）。
 *
 * register_mode = email：邮箱 + 密码注册（Shopify 路线，独立站常用）
 * register_mode = phone：手机号 + 验证码，注册即登录（淘宝路线）
 * 两种都是成熟做法，面国内还是面海外由商家自己定 —— 所以是店铺设置，不是代码常量。
 */
const authSettingsBody = z.object({
  register_mode: z.enum(["email", "phone"]).optional(),
});

/** Admin 设置（openapi 1664/1703/1726）+ provider 配置读写。settings 需 admin 权限（staff → 403）。 */
export function adminSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get("/api/v1/admin/settings", { preHandler: guard }, async (_req, reply) => {
    reply.ok({ settings: await deps.services.theme.getSettings() });
  });

  app.patch(
    "/api/v1/admin/settings",
    { preHandler: guard, schema: { body: patchSettingsBody } },
    async (req, reply) => {
      const before = await deps.services.theme.getSettings();
      const settings = await deps.services.theme.updateSettings(req.body as Partial<ThemeSettingsDTO>);
      await deps.audit.record(
        auditEntry(req, {
          action: "settings.update",
          entityType: "settings",
          entityId: before.id,
          before,
          after: settings,
        }),
      );
      reply.ok({ settings });
    },
  );

  app.put(
    "/api/v1/admin/settings/theme",
    { preHandler: guard, schema: { body: themeBody } },
    async (req, reply) => {
      const before = await deps.services.theme.getSettings();
      const theme = await deps.services.theme.updateSettings(req.body as Partial<ThemeSettingsDTO>);
      await deps.audit.record(
        auditEntry(req, {
          action: "theme.update",
          entityType: "theme",
          entityId: theme.id,
          before,
          after: theme,
        }),
      );
      reply.ok({ theme });
    },
  );

  app.get("/api/v1/admin/settings/auth", { preHandler: guard }, async (_req, reply) => {
    reply.ok(await deps.services.auth.getSettings());
  });

  app.put(
    "/api/v1/admin/settings/auth",
    { preHandler: guard, schema: { body: authSettingsBody } },
    async (req, reply) => {
      const before = await deps.services.auth.getSettings();
      const after = await deps.services.auth.updateSettings(
        req.body as z.infer<typeof authSettingsBody>,
      );
      await deps.audit.record(
        auditEntry(req, {
          action: "auth.settings.update",
          entityType: "auth_settings",
          entityId: "auth_default",
          before,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  app.put(
    "/api/v1/admin/settings/payment-providers/:id",
    { preHandler: guard, schema: { body: providerConfigBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as z.infer<typeof providerConfigBody>;
      const before = await deps.services.payment.getProviderConfig(id);
      const view = await deps.services.payment.configureProvider({
        identifier: id,
        options: b.options,
        enabledChannels: b.enabled_channels,
      });
      // 落库的是掩码视图（options_masked），明文密钥不进审计表。
      await deps.audit.record(
        auditEntry(req, {
          action: "payment_provider.configure",
          entityType: "payment_provider",
          entityId: id,
          before,
          after: view,
        }),
      );
      reply.ok(view);
    },
  );

  app.get("/api/v1/admin/settings/payment-providers/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = await deps.services.payment.getProviderConfig(id);
    reply.ok(view);
  });
}
