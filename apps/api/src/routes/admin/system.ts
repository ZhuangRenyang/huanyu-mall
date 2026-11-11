import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { errors } from "@mall/core";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

const settingsBody = z.object({
  // 校验放在 schema 层：谁实现服务都拦得住，不依赖实现自觉
  update_source_url: z
    .string()
    .max(500)
    .refine((v) => v.trim() === "" || /^https?:\/\//i.test(v.trim()), {
      message: "更新源地址必须以 http:// 或 https:// 开头",
    }),
});

const upgradeBody = z.object({
  version: z.string().min(1).max(40),
  tarball_url: z.string().url(),
  sha256: z.string().length(64),
  /** 破坏性操作：必须显式确认，避免误触把线上换掉。 */
  confirm: z.literal(true),
});

const backupBody = z.object({
  label: z.string().max(60).optional(),
});

const progressBody = z.object({
  progress: z.number().int().min(0).max(100).optional(),
  step: z.string().max(200).optional(),
  log: z.string().max(4000).optional(),
});

const completeBody = z.object({
  status: z.enum(["succeeded", "failed", "canceled"]),
  result: z.record(z.string(), z.unknown()).nullish(),
  error: z.string().max(2000).nullish(),
  log: z.string().max(4000).nullish(),
});

const heartbeatBody = z.object({ version: z.string().max(40) });

/**
 * 系统信息与一键升级（ADR-017）。
 *
 * 两类调用方，鉴权完全不同：
 *   - 后台管理员（RBAC settings）：查信息、配更新源、发起升级/备份
 *   - 宿主升级代理（UPDATER_TOKEN）：领作业、报进度、报结果
 *
 * API 自己绝不执行宿主命令：它在容器里，也没有那个能力。
 */
export function adminSystemRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);
  const guard = [auth.adminAuth, auth.requirePermission("settings")];

  app.get("/api/v1/admin/system/info", { preHandler: guard }, async (_req, reply) => {
    reply.ok(await deps.services.systemUpdate.getInfo());
  });

  app.put(
    "/api/v1/admin/system/settings",
    { preHandler: guard, schema: { body: settingsBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof settingsBody>;
      const before = await deps.services.systemUpdate.getInfo();
      const after = await deps.services.systemUpdate.setUpdateSource(body.update_source_url);
      await deps.audit.record(
        auditEntry(req, {
          action: "system.settings.update",
          entityType: "system_settings",
          entityId: "system_default",
          before: { update_source_url: before.settings.update_source_url },
          after: { update_source_url: after.update_source_url },
        }),
      );
      reply.ok(after);
    },
  );

  app.post("/api/v1/admin/system/check-update", { preHandler: guard }, async (_req, reply) => {
    reply.ok(await deps.services.systemUpdate.checkUpdate());
  });

  app.post(
    "/api/v1/admin/system/upgrade",
    { preHandler: guard, schema: { body: upgradeBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof upgradeBody>;
      const job = await deps.services.systemUpdate.createJob(
        "upgrade",
        {
          version: body.version,
          tarball_url: body.tarball_url,
          sha256: body.sha256,
        },
        req.auth?.sub ?? null,
      );
      await deps.audit.record(
        auditEntry(req, {
          action: "system.upgrade.request",
          entityType: "system_update_job",
          entityId: job.id,
          after: { version: body.version, tarball_url: body.tarball_url },
        }),
      );
      reply.code(201).ok(job);
    },
  );

  app.post(
    "/api/v1/admin/system/backup",
    { preHandler: guard, schema: { body: backupBody } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof backupBody>;
      const job = await deps.services.systemUpdate.createJob(
        "backup",
        { label: body.label ?? "manual" },
        req.auth?.sub ?? null,
      );
      await deps.audit.record(
        auditEntry(req, {
          action: "system.backup.request",
          entityType: "system_update_job",
          entityId: job.id,
        }),
      );
      reply.code(201).ok(job);
    },
  );

  app.get("/api/v1/admin/system/jobs", { preHandler: guard }, async (_req, reply) => {
    const items = await deps.services.systemUpdate.listJobs(20);
    reply.ok({ items, count: items.length });
  });

  app.get("/api/v1/admin/system/jobs/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await deps.services.systemUpdate.getJob(id);
    if (!job) throw errors.validation(`作业不存在：${id}`);
    reply.ok(job);
  });

  // —— 升级代理（宿主 systemd 服务）——

  const agentGuard = async (req: FastifyRequest): Promise<void> => {
    const token = process.env.UPDATER_TOKEN ?? "";
    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    // 常量时间比较：代理 token 是长期凭证，不给时序侧信道留缝
    const a = Buffer.from(provided);
    const b = Buffer.from(token);
    if (!token || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw errors.unauthenticated("升级代理鉴权失败");
    }
  };

  app.post(
    "/api/v1/system-update/agent/heartbeat",
    { preHandler: agentGuard, schema: { body: heartbeatBody } },
    async (req, reply) => {
      await deps.services.systemUpdate.heartbeat((req.body as z.infer<typeof heartbeatBody>).version);
      reply.ok({ ok: true });
    },
  );

  app.get("/api/v1/system-update/agent/next", { preHandler: agentGuard }, async (_req, reply) => {
    reply.ok({ job: await deps.services.systemUpdate.claimNextJob() });
  });

  app.post(
    "/api/v1/system-update/agent/jobs/:id/progress",
    { preHandler: agentGuard, schema: { body: progressBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await deps.services.systemUpdate.reportProgress(id, req.body as z.infer<typeof progressBody>);
      reply.ok({ ok: true });
    },
  );

  app.post(
    "/api/v1/system-update/agent/jobs/:id/complete",
    { preHandler: agentGuard, schema: { body: completeBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await deps.services.systemUpdate.completeJob(id, req.body as z.infer<typeof completeBody>);
      reply.ok({ ok: true });
    },
  );
}
