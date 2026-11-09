import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { makeAuthHelpers } from "../../plugins/auth.js";
import { auditEntry } from "../audit-context.js";

/** 登录标识：邮箱或管理员名（内置管理员登录标识为 admin）。 */
const loginBody = z.object({ email: z.string().min(1), password: z.string() });
const refreshBody = z.object({ refresh_token: z.string() });
/**
 * 改密请求体：只传当前口令与新口令，不接受管理员 id（防越权改别人口令）。
 * 强度规则（至少 8 位 + 字母 + 数字）由 auth 模块统一裁决，这里只校验形状。
 */
const changePasswordBody = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});

function tokenResponse(pair: { accessToken: string; refreshToken: string; accessExpiresIn: number }) {
  return {
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    token_type: "Bearer",
    expires_in: pair.accessExpiresIn,
  };
}

/** Admin 认证 4 端点（openapi 1136/1160/1184）+ 管理员改密。 */
export function adminAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = makeAuthHelpers(deps);

  app.post(
    "/api/v1/admin/auth/login",
    { schema: { body: loginBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof loginBody>;
      reply.ok(tokenResponse(await deps.services.auth.adminLogin({ email: b.email, password: b.password })));
    },
  );

  /**
   * 管理员自助改密：校验当前口令 → 撤销该管理员全部会话 → 覆盖口令哈希。
   * 改密后不签发新 token，用户需重新登录。
   */
  app.post(
    "/api/v1/admin/auth/change-password",
    { preHandler: [auth.adminAuth], schema: { body: changePasswordBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof changePasswordBody>;
      const identityId = req.auth!.sub;
      const result = await deps.services.auth.changeAdminPassword({
        identityId,
        currentPassword: b.current_password,
        newPassword: b.new_password,
      });
      // 审计只记操作者/动作/实体与被撤销的会话数，不记口令明文，也不记哈希。
      await deps.audit.record(
        auditEntry(req, {
          action: "admin.change_password",
          entityType: "admin_user",
          entityId: identityId,
          after: { revoked_refresh_tokens: result.revokedRefreshTokens },
        }),
      );
      reply.ok({
        changed: true,
        revoked_refresh_tokens: result.revokedRefreshTokens,
        reauth_required: true,
        message: "密码已修改，请使用新密码重新登录",
      });
    },
  );

  app.post(
    "/api/v1/admin/auth/refresh",
    { schema: { body: refreshBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof refreshBody>;
      reply.ok(tokenResponse(await deps.services.auth.refresh(b.refresh_token)));
    },
  );

  app.post(
    "/api/v1/admin/auth/logout",
    { schema: { body: refreshBody } },
    async (req, reply) => {
      const b = req.body as z.infer<typeof refreshBody>;
      await deps.services.auth.logout(b.refresh_token);
      reply.code(204).send();
    },
  );
}
