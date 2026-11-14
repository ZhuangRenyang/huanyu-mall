import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";

/** 应用接入状态（ADR-084）：给「应用」页一张真实的清单，不是静态说明。 */
export function adminAppsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get("/api/v1/admin/apps/status", { preHandler: guard }, async (_req, reply) => {
    const [providers, mail, channels] = await Promise.all([
      deps.services.payment.listProviderConfigs(),
      deps.services.notification.getSettings(),
      deps.services.regionChannel.listChannels({ isActive: true }),
    ]);
    reply.ok({
      payments: {
        total: providers.length,
        enabled: providers.filter((p) => p.is_enabled).length,
      },
      mail: {
        enabled: mail.enabled === true,
        smtp_configured: Boolean(mail.smtp_host) && Boolean(mail.from_email),
      },
      channels: { active: channels.length, currency: channels[0]?.currency_code ?? null },
    });
  });
}
