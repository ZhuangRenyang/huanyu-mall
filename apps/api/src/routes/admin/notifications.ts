import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

const settingsBody = z.object({
  enabled: z.boolean().optional(),
  from_name: z.string().max(120).optional(),
  from_email: z.string().max(200).optional(),
  smtp_host: z.string().max(200).optional(),
  smtp_port: z.number().int().min(1).max(65535).optional(),
  smtp_secure: z.boolean().optional(),
  smtp_user: z.string().max(200).optional(),
  /** 不传 = 保持不变；空字符串 = 清除。 */
  smtp_password: z.string().max(500).optional(),
  order_confirmation_enabled: z.boolean().optional(),
  shipment_enabled: z.boolean().optional(),
  storefront_url: z.string().max(500).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  status: z.enum(["pending", "sending", "sent", "failed"]).optional(),
});

const testBody = z.object({ to: z.string().email() });

/**
 * Admin 通知（ADR-016）：SMTP 配置、测试发送、通知记录与重发。
 * 权限与「设置」同权（settings），staff 不可见。
 * 审计只记录 `smtp_password_set`，密码本身永不进审计日志。
 */
export function adminNotificationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get("/api/v1/admin/notifications/settings", { preHandler: guard }, async (_req, reply) => {
    reply.ok(await deps.services.notification.getSettings());
  });

  app.put(
    "/api/v1/admin/notifications/settings",
    { preHandler: guard, schema: { body: settingsBody } },
    async (req, reply) => {
      const before = await deps.services.notification.getSettings();
      const after = await deps.services.notification.updateSettings(req.body as z.infer<typeof settingsBody>);
      await deps.audit.record(
        auditEntry(req, {
          action: "notification.settings.update",
          entityType: "notification_settings",
          entityId: "notification_default",
          before,
          after,
        }),
      );
      reply.ok(after);
    },
  );

  app.post(
    "/api/v1/admin/notifications/test",
    { preHandler: guard, schema: { body: testBody } },
    async (req, reply) => {
      const { to } = req.body as z.infer<typeof testBody>;
      await deps.services.notification.sendTest(to);
      await deps.audit.record(
        auditEntry(req, {
          action: "notification.test.send",
          entityType: "notification",
          entityId: to,
        }),
      );
      reply.ok({ ok: true });
    },
  );

  app.get(
    "/api/v1/admin/notifications",
    { preHandler: guard, schema: { querystring: listQuery } },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const res = await deps.services.notification.list({
        limit: q.limit,
        offset: q.offset,
        ...(q.status ? { status: q.status } : {}),
      });
      reply.ok({
        items: res.items,
        count: res.count,
        offset: q.offset,
        limit: q.limit,
        hasMore: q.offset + res.items.length < res.count,
      });
    },
  );

  app.post("/api/v1/admin/notifications/:id/resend", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await deps.services.notification.resend(id);
    await deps.audit.record(
      auditEntry(req, {
        action: "notification.resend",
        entityType: "notification",
        entityId: id,
        before: { status: "pending" },
        after: { status: row.status },
      }),
    );
    reply.ok(row);
  });
}
